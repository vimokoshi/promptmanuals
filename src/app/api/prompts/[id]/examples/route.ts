import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { randomUUID } from "crypto";

const addExampleSchema = z.object({
  mediaUrl: z.string().url(),
  comment: z.string().max(500).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: promptId } = await params;

  let promptOid: ObjectId;
  try {
    promptOid = new ObjectId(promptId);
  } catch {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  const prompt = await promptsCol().findOne(
    { _id: promptOid },
    { projection: { type: 1, userExamples: 1 } }
  );

  if (!prompt) {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  // Only allow examples for IMAGE and VIDEO prompts
  if (prompt.type !== "IMAGE" && prompt.type !== "VIDEO") {
    return NextResponse.json(
      { error: "Examples not supported for this prompt type" },
      { status: 400 }
    );
  }

  const rawExamples = (prompt.userExamples ?? []).slice().sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );

  // Enrich with user info
  const userIds = [...new Set(rawExamples.map((e) => e.userId))];
  const users = await usersCol()
    .find(
      { _id: { $in: userIds as any } },
      { projection: { _id: 1, username: 1, name: 1, avatar: 1 } }
    )
    .toArray();
  const userMap = new Map(
    users.map((u) => [
      u._id.toHexString(),
      { id: u._id.toHexString(), username: u.username, name: u.name, avatar: u.avatar },
    ])
  );

  const examples = rawExamples.map((e) => ({
    ...e,
    id: e._id,
    user: userMap.get(e.userId) ?? null,
  }));

  return NextResponse.json({ examples });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: promptId } = await params;

  let promptOid: ObjectId;
  try {
    promptOid = new ObjectId(promptId);
  } catch {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  try {
    const body = await req.json();
    const { mediaUrl, comment } = addExampleSchema.parse(body);

    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { type: 1, isPrivate: 1, authorId: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Only allow examples for IMAGE and VIDEO prompts
    if (prompt.type !== "IMAGE" && prompt.type !== "VIDEO") {
      return NextResponse.json(
        { error: "Examples not supported for this prompt type" },
        { status: 400 }
      );
    }

    // Don't allow adding examples to private prompts (unless owner)
    if (prompt.isPrivate && prompt.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "Cannot add example to private prompt" },
        { status: 403 }
      );
    }

    const newExample = {
      _id: randomUUID(),
      mediaUrl,
      comment: comment ?? null,
      createdAt: new Date(),
      userId: session.user.id,
    };

    await promptsCol().updateOne(
      { _id: promptOid },
      { $push: { userExamples: newExample } as any }
    );

    // Fetch user info for response
    const user = await usersCol().findOne(
      { _id: session.user.id as any },
      { projection: { _id: 1, username: 1, name: 1, avatar: 1 } }
    );

    const example = {
      ...newExample,
      id: newExample._id,
      user: user
        ? {
            id: user._id.toHexString(),
            username: user.username,
            name: user.name,
            avatar: user.avatar,
          }
        : null,
    };

    return NextResponse.json({ example });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input", details: error.issues },
        { status: 400 }
      );
    }
    console.error("Failed to add example:", error);
    return NextResponse.json({ error: "Failed to add example" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: promptId } = await params;

  let promptOid: ObjectId;
  try {
    promptOid = new ObjectId(promptId);
  } catch {
    return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const exampleId = searchParams.get("exampleId");

    if (!exampleId) {
      return NextResponse.json({ error: "exampleId required" }, { status: 400 });
    }

    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { userExamples: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const example = (prompt.userExamples ?? []).find((e) => e._id === exampleId);

    if (!example) {
      return NextResponse.json({ error: "Example not found" }, { status: 404 });
    }

    // Only allow owner or admin to delete
    const isAdmin = session.user.role === "ADMIN";
    if (example.userId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    await promptsCol().updateOne(
      { _id: promptOid },
      { $pull: { userExamples: { _id: exampleId } } as any }
    );

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete example:", error);
    return NextResponse.json({ error: "Failed to delete example" }, { status: 500 });
  }
}
