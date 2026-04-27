import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { commentsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { getConfig } from "@/lib/config";
import { z } from "zod";

const voteSchema = z.object({
  value: z.number().refine((v) => v === 1 || v === -1, {
    message: "Vote value must be 1 (upvote) or -1 (downvote)",
  }),
});

// POST - Vote on a comment (upvote or downvote)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const config = await getConfig();
    if (config.features.comments === false) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Comments are disabled" },
        { status: 403 }
      );
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId, commentId } = await params;
    const body = await request.json();

    const validation = voteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "validation_error", message: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { value } = validation.data;
    const userId = session.user.id;

    let commentOid: ObjectId;
    try {
      commentOid = new ObjectId(commentId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Comment not found" },
        { status: 404 }
      );
    }

    const comment = await commentsCol().findOne(
      { _id: commentOid, deletedAt: null },
      { projection: { _id: 1, promptId: 1, votes: 1, score: 1 } }
    );

    if (!comment || comment.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Comment not found" },
        { status: 404 }
      );
    }

    const votes = comment.votes ?? [];
    const existingVote = votes.find((v) => v.userId === userId);

    if (existingVote) {
      if (existingVote.value === value) {
        // Same vote — toggle off (remove)
        await commentsCol().updateOne(
          { _id: commentOid },
          {
            $pull: { votes: { userId } } as any,
            $inc: { score: -existingVote.value },
            $set: { updatedAt: new Date() },
          }
        );
      } else {
        // Different vote — replace
        await commentsCol().updateOne(
          { _id: commentOid },
          {
            $pull: { votes: { userId } } as any,
            $inc: { score: value - existingVote.value },
            $set: { updatedAt: new Date() },
          }
        );
        await commentsCol().updateOne(
          { _id: commentOid },
          {
            $push: { votes: { userId, value, createdAt: new Date() } } as any,
          }
        );
      }
    } else {
      // No existing vote — add
      await commentsCol().updateOne(
        { _id: commentOid },
        {
          $push: { votes: { userId, value, createdAt: new Date() } } as any,
          $inc: { score: value },
          $set: { updatedAt: new Date() },
        }
      );
    }

    // Re-fetch updated comment to return accurate score and userVote
    const updated = await commentsCol().findOne(
      { _id: commentOid },
      { projection: { score: 1, votes: 1 } }
    );

    const userVote =
      updated?.votes?.find((v) => v.userId === userId)?.value ?? 0;

    return NextResponse.json({
      score: updated?.score ?? 0,
      userVote,
    });
  } catch (error) {
    console.error("Vote comment error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// DELETE - Remove vote from a comment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  try {
    const config = await getConfig();
    if (config.features.comments === false) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Comments are disabled" },
        { status: 403 }
      );
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { commentId } = await params;
    const userId = session.user.id;

    let commentOid: ObjectId;
    try {
      commentOid = new ObjectId(commentId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Comment not found" },
        { status: 404 }
      );
    }

    const comment = await commentsCol().findOne(
      { _id: commentOid },
      { projection: { votes: 1 } }
    );

    const existingVote = comment?.votes?.find((v) => v.userId === userId);
    const scoreAdj = existingVote ? -existingVote.value : 0;

    await commentsCol().updateOne(
      { _id: commentOid },
      {
        $pull: { votes: { userId } } as any,
        $inc: { score: scoreAdj },
        $set: { updatedAt: new Date() },
      }
    );

    const updated = await commentsCol().findOne(
      { _id: commentOid },
      { projection: { score: 1 } }
    );

    return NextResponse.json({ score: updated?.score ?? 0, userVote: 0 });
  } catch (error) {
    console.error("Unvote comment error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
