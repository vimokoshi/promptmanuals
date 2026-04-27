import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol, pinnedPromptsCol } from "@/lib/mongodb";

const MAX_PINNED_PROMPTS = 3;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: promptId } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(promptId);
    } catch {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const userId = session.user.id;

    // Check if prompt exists and belongs to user
    const prompt = await promptsCol().findOne(
      { _id: oid },
      { projection: { authorId: 1, isPrivate: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    if (prompt.authorId !== userId) {
      return NextResponse.json(
        { error: "You can only pin your own prompts" },
        { status: 403 }
      );
    }

    // Check if already pinned
    const existingPin = await pinnedPromptsCol().findOne({ userId, promptId });

    if (existingPin) {
      return NextResponse.json({ error: "Prompt already pinned" }, { status: 400 });
    }

    // Check pin limit
    const pinnedCount = await pinnedPromptsCol().countDocuments({ userId });

    if (pinnedCount >= MAX_PINNED_PROMPTS) {
      return NextResponse.json(
        { error: `You can only pin up to ${MAX_PINNED_PROMPTS} prompts` },
        { status: 400 }
      );
    }

    // Get next order number
    const maxOrderDoc = await pinnedPromptsCol()
      .find({ userId })
      .sort({ order: -1 })
      .limit(1)
      .toArray();

    const nextOrder = maxOrderDoc.length > 0 ? maxOrderDoc[0].order + 1 : 0;

    await pinnedPromptsCol().insertOne({
      _id: new ObjectId(),
      userId,
      promptId,
      order: nextOrder,
      createdAt: new Date(),
    });

    return NextResponse.json({ success: true, pinned: true });
  } catch (error) {
    console.error("Failed to pin prompt:", error);
    return NextResponse.json({ error: "Failed to pin prompt" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: promptId } = await params;
    const userId = session.user.id;

    await pinnedPromptsCol().deleteOne({ userId, promptId });

    return NextResponse.json({ success: true, pinned: false });
  } catch (error) {
    console.error("Failed to unpin prompt:", error);
    return NextResponse.json({ error: "Failed to unpin prompt" }, { status: 500 });
  }
}
