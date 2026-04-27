import { NextRequest, NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, promptConnectionsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const updateConnectionSchema = z.object({
  label: z.string().min(1).max(100).optional(),
  order: z.number().int().min(0).optional(),
});

interface RouteParams {
  params: Promise<{ id: string; connectionId: string }>;
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, connectionId } = await params;

  try {
    let connectionOid: ObjectId;
    try {
      connectionOid = new ObjectId(connectionId);
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const connection = await promptConnectionsCol().findOne({ _id: connectionOid });

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    if (connection.sourceId !== id) {
      return NextResponse.json(
        { error: "Connection does not belong to this prompt" },
        { status: 400 }
      );
    }

    // Fetch source prompt for ownership check
    let sourceOid: ObjectId;
    try {
      sourceOid = new ObjectId(connection.sourceId);
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const sourcePrompt = await promptsCol().findOne(
      { _id: sourceOid },
      { projection: { authorId: 1 } }
    );

    if (
      !sourcePrompt ||
      (sourcePrompt.authorId !== session.user.id && session.user.role !== "ADMIN")
    ) {
      return NextResponse.json(
        { error: "You can only delete connections from your own prompts" },
        { status: 403 }
      );
    }

    await promptConnectionsCol().deleteOne({ _id: connectionOid });

    // Revalidate the prompt page and flow cache
    revalidatePath(`/prompts/${id}`);
    revalidateTag("prompt-flow", "max");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete connection:", error);
    return NextResponse.json(
      { error: "Failed to delete connection" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, connectionId } = await params;

  try {
    const body = await request.json();
    const data = updateConnectionSchema.parse(body);

    let connectionOid: ObjectId;
    try {
      connectionOid = new ObjectId(connectionId);
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const connection = await promptConnectionsCol().findOne({ _id: connectionOid });

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      );
    }

    if (connection.sourceId !== id) {
      return NextResponse.json(
        { error: "Connection does not belong to this prompt" },
        { status: 400 }
      );
    }

    // Fetch source prompt for ownership check
    let sourceOid: ObjectId;
    try {
      sourceOid = new ObjectId(connection.sourceId);
    } catch {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const sourcePrompt = await promptsCol().findOne(
      { _id: sourceOid },
      { projection: { authorId: 1 } }
    );

    if (
      !sourcePrompt ||
      (sourcePrompt.authorId !== session.user.id && session.user.role !== "ADMIN")
    ) {
      return NextResponse.json(
        { error: "You can only update connections on your own prompts" },
        { status: 403 }
      );
    }

    const now = new Date();
    await promptConnectionsCol().updateOne(
      { _id: connectionOid },
      { $set: { ...data, updatedAt: now } }
    );

    // Fetch target for response
    let targetOid: ObjectId;
    try {
      targetOid = new ObjectId(connection.targetId);
    } catch {
      targetOid = connection.targetId as unknown as ObjectId;
    }
    const target = await promptsCol().findOne(
      { _id: targetOid },
      { projection: { _id: 1, title: 1, slug: 1 } }
    );

    const updated = {
      id: connectionOid.toHexString(),
      sourceId: connection.sourceId,
      targetId: connection.targetId,
      label: data.label ?? connection.label,
      order: data.order ?? connection.order,
      updatedAt: now,
      target: target
        ? { id: target._id.toHexString(), title: target.title, slug: target.slug }
        : null,
    };

    // Revalidate prompt flow cache
    revalidateTag("prompt-flow", "max");

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues }, { status: 400 });
    }
    console.error("Failed to update connection:", error);
    return NextResponse.json(
      { error: "Failed to update connection" },
      { status: 500 }
    );
  }
}
