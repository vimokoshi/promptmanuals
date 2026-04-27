import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, promptConnectionsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const createConnectionSchema = z.object({
  targetId: z.string().min(1),
  label: z.string().min(1).max(100),
  order: z.number().int().min(0).optional(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const prompt = await promptsCol().findOne(
      { _id: promptOid, deletedAt: null },
      { projection: { isPrivate: 1, authorId: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Get all connections where this prompt is involved (source or target)
    // Exclude "related" label connections
    const [outgoingRaw, incomingRaw] = await Promise.all([
      promptConnectionsCol()
        .find({ sourceId: id, label: { $ne: "related" } })
        .sort({ order: 1 })
        .toArray(),
      promptConnectionsCol()
        .find({ targetId: id, label: { $ne: "related" } })
        .sort({ order: 1 })
        .toArray(),
    ]);

    // Collect all referenced prompt IDs
    const targetIds = outgoingRaw.map((c) => c.targetId);
    const sourceIds = incomingRaw.map((c) => c.sourceId);
    const allIds = [...new Set([...targetIds, ...sourceIds])];

    // Fetch referenced prompts in one query
    const referencedPrompts = await promptsCol()
      .find(
        { _id: { $in: allIds.map((pid) => { try { return new ObjectId(pid); } catch { return pid as any; } }) } },
        { projection: { _id: 1, title: 1, slug: 1, isPrivate: 1, authorId: 1 } }
      )
      .toArray();
    const promptMap = new Map(
      referencedPrompts.map((p) => [
        p._id.toHexString(),
        {
          id: p._id.toHexString(),
          title: p.title,
          slug: p.slug,
          isPrivate: p.isPrivate,
          authorId: p.authorId,
        },
      ])
    );

    // Filter out private prompts the user can't see
    const session = await auth();
    const userId = session?.user?.id;

    const outgoing = outgoingRaw
      .map((c) => ({
        id: c._id.toHexString(),
        sourceId: c.sourceId,
        targetId: c.targetId,
        label: c.label,
        order: c.order,
        target: promptMap.get(c.targetId) ?? null,
      }))
      .filter((c) => c.target && (!c.target.isPrivate || c.target.authorId === userId));

    const incoming = incomingRaw
      .map((c) => ({
        id: c._id.toHexString(),
        sourceId: c.sourceId,
        targetId: c.targetId,
        label: c.label,
        order: c.order,
        source: promptMap.get(c.sourceId) ?? null,
      }))
      .filter((c) => c.source && (!c.source.isPrivate || c.source.authorId === userId));

    return NextResponse.json({ outgoing, incoming });
  } catch (error) {
    console.error("Failed to fetch connections:", error);
    return NextResponse.json(
      { error: "Failed to fetch connections" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { targetId, label, order } = createConnectionSchema.parse(body);

    let sourceOid: ObjectId;
    try {
      sourceOid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Source prompt not found" }, { status: 404 });
    }

    // Verify source prompt exists and user owns it
    const sourcePrompt = await promptsCol().findOne(
      { _id: sourceOid, deletedAt: null },
      { projection: { authorId: 1 } }
    );

    if (!sourcePrompt) {
      return NextResponse.json(
        { error: "Source prompt not found" },
        { status: 404 }
      );
    }

    if (
      sourcePrompt.authorId !== session.user.id &&
      session.user.role !== "ADMIN"
    ) {
      return NextResponse.json(
        { error: "You can only add connections to your own prompts" },
        { status: 403 }
      );
    }

    let targetOid: ObjectId;
    try {
      targetOid = new ObjectId(targetId);
    } catch {
      return NextResponse.json({ error: "Target prompt not found" }, { status: 404 });
    }

    // Verify target prompt exists
    const targetPrompt = await promptsCol().findOne(
      { _id: targetOid, deletedAt: null },
      { projection: { title: 1, authorId: 1 } }
    );

    if (!targetPrompt) {
      return NextResponse.json(
        { error: "Target prompt not found" },
        { status: 404 }
      );
    }

    // Verify user owns the target prompt
    if (
      targetPrompt.authorId !== session.user.id &&
      session.user.role !== "ADMIN"
    ) {
      return NextResponse.json(
        { error: "You can only connect to your own prompts" },
        { status: 403 }
      );
    }

    // Prevent self-connection
    if (id === targetId) {
      return NextResponse.json(
        { error: "Cannot connect a prompt to itself" },
        { status: 400 }
      );
    }

    // Check if connection already exists
    const existing = await promptConnectionsCol().findOne({ sourceId: id, targetId });

    if (existing) {
      return NextResponse.json(
        { error: "Connection already exists" },
        { status: 400 }
      );
    }

    // Calculate order if not provided
    let connectionOrder = order;
    if (connectionOrder === undefined) {
      const lastConnection = await promptConnectionsCol()
        .find({ sourceId: id })
        .sort({ order: -1 })
        .limit(1)
        .toArray();
      connectionOrder = (lastConnection[0]?.order ?? -1) + 1;
    }

    const now = new Date();
    const result = await promptConnectionsCol().insertOne({
      sourceId: id,
      targetId,
      label,
      order: connectionOrder,
      createdAt: now,
      updatedAt: now,
    } as any);

    const connection = {
      id: result.insertedId.toHexString(),
      sourceId: id,
      targetId,
      label,
      order: connectionOrder,
      createdAt: now,
      updatedAt: now,
      target: {
        id: targetId,
        title: targetPrompt.title,
        slug: null as string | null,
      },
    };

    // Revalidate prompt flow cache
    revalidateTag("prompt-flow");

    return NextResponse.json(connection, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Failed to create connection:", error);
    return NextResponse.json(
      { error: "Failed to create connection" },
      { status: 500 }
    );
  }
}
