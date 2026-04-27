import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";

// POST - Upvote a prompt
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const userId = session.user.id;

    const prompt = await promptsCol().findOne(
      { _id: oid },
      { projection: { votes: 1, voteCount: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const hasVoted = prompt.votes?.some((v) => v.userId === userId);

    if (hasVoted) {
      return NextResponse.json(
        { error: "already_voted", message: "You have already upvoted this prompt" },
        { status: 400 }
      );
    }

    await promptsCol().updateOne(
      { _id: oid },
      {
        $push: { votes: { userId, createdAt: new Date() } } as any,
        $inc: { voteCount: 1 },
      }
    );

    const updated = await promptsCol().findOne(
      { _id: oid },
      { projection: { voteCount: 1 } }
    );

    return NextResponse.json({ voted: true, voteCount: updated?.voteCount ?? 0 });
  } catch (error) {
    console.error("Vote error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// DELETE - Remove upvote from a prompt
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const userId = session.user.id;

    await promptsCol().updateOne(
      { _id: oid },
      {
        $pull: { votes: { userId } } as any,
        $inc: { voteCount: -1 },
      }
    );

    const updated = await promptsCol().findOne(
      { _id: oid },
      { projection: { voteCount: 1 } }
    );

    return NextResponse.json({ voted: false, voteCount: updated?.voteCount ?? 0 });
  } catch (error) {
    console.error("Unvote error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
