import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { commentsCol, promptsCol, usersCol, notificationsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { getConfig } from "@/lib/config";
import { z } from "zod";

const createCommentSchema = z.object({
  content: z.string().min(1).max(10000),
  parentId: z.string().optional(),
});

// GET - Get all comments for a prompt
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const config = await getConfig();
    if (config.features.comments === false) {
      return NextResponse.json(
        { error: "feature_disabled", message: "Comments are disabled" },
        { status: 403 }
      );
    }

    const { id: promptId } = await params;
    const session = await auth();

    // Check if prompt exists
    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const prompt = await promptsCol().findOne(
      { _id: promptOid, deletedAt: null },
      { projection: { _id: 1, isPrivate: 1, authorId: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Check if user can view private prompt
    if (prompt.isPrivate && prompt.authorId !== session?.user?.id) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const isAdmin = session?.user?.role === "ADMIN";
    const userId = session?.user?.id;

    // Get all non-deleted comments for this prompt
    const comments = await commentsCol()
      .find({ promptId, deletedAt: null })
      .sort({ createdAt: 1 })
      .toArray();

    // Gather unique authorIds to batch-fetch authors
    const authorIds = [...new Set(comments.map((c) => c.authorId))];
    const authorDocs = authorIds.length
      ? await usersCol()
          .find(
            { _id: { $in: authorIds.map((aid) => { try { return new ObjectId(aid); } catch { return null; } }).filter(Boolean) as ObjectId[] } },
            { projection: { _id: 1, name: 1, username: 1, avatar: 1, role: 1 } }
          )
          .toArray()
      : [];

    const authorMap = new Map(
      authorDocs.map((u) => [
        u._id.toHexString(),
        {
          id: u._id.toHexString(),
          name: u.name,
          username: u.username,
          avatar: u.avatar ?? null,
          role: u.role,
        },
      ])
    );

    // Transform and filter comments
    // Shadow-ban: flagged comments only visible to admins and the comment author
    const transformedComments = comments
      .filter((comment) => {
        if (isAdmin) return true;
        if (!comment.flagged) return true;
        return comment.authorId === userId;
      })
      .map((comment) => {
        const userVote = userId
          ? (comment.votes ?? []).find((v) => v.userId === userId)?.value ?? 0
          : 0;

        // Count replies (comments whose parentId equals this comment's id)
        const commentIdStr = comment._id.toHexString();
        const replyCount = comments.filter(
          (c) => c.parentId === commentIdStr
        ).length;

        return {
          id: commentIdStr,
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          parentId: comment.parentId,
          flagged: isAdmin ? comment.flagged : false,
          author: authorMap.get(comment.authorId) ?? null,
          score: comment.score,
          userVote,
          replyCount,
        };
      });

    return NextResponse.json({ comments: transformedComments });
  } catch (error) {
    console.error("Get comments error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// POST - Create a new comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: promptId } = await params;
    const body = await request.json();

    const validation = createCommentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: "validation_error", message: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { content, parentId } = validation.data;

    // Check if prompt exists
    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const prompt = await promptsCol().findOne(
      { _id: promptOid, deletedAt: null },
      { projection: { _id: 1, isPrivate: 1, authorId: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (prompt.isPrivate && prompt.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // If replying to a comment, verify parent exists and belongs to same prompt
    if (parentId) {
      let parentOid: ObjectId;
      try {
        parentOid = new ObjectId(parentId);
      } catch {
        return NextResponse.json(
          { error: "invalid_parent", message: "Parent comment not found" },
          { status: 400 }
        );
      }

      const parentComment = await commentsCol().findOne(
        { _id: parentOid, deletedAt: null },
        { projection: { _id: 1, promptId: 1 } }
      );

      if (!parentComment || parentComment.promptId !== promptId) {
        return NextResponse.json(
          { error: "invalid_parent", message: "Parent comment not found" },
          { status: 400 }
        );
      }
    }

    // Create comment
    const now = new Date();
    const insertResult = await commentsCol().insertOne({
      content,
      promptId,
      authorId: session.user.id,
      parentId: parentId ?? null,
      score: 0,
      votes: [],
      flagged: false,
      flaggedAt: null,
      flaggedBy: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    } as any);

    const commentId = insertResult.insertedId.toHexString();

    // Fetch author for response
    let authorOid: ObjectId;
    try {
      authorOid = new ObjectId(session.user.id);
    } catch {
      authorOid = new ObjectId();
    }
    const authorDoc = await usersCol().findOne(
      { _id: authorOid },
      { projection: { _id: 1, name: 1, username: 1, avatar: 1, role: 1 } }
    );
    const author = authorDoc
      ? {
          id: authorDoc._id.toHexString(),
          name: authorDoc.name,
          username: authorDoc.username,
          avatar: authorDoc.avatar ?? null,
          role: authorDoc.role,
        }
      : null;

    // Create notification for prompt owner (if not commenting on own prompt)
    if (prompt.authorId !== session.user.id) {
      await notificationsCol().insertOne({
        type: "COMMENT",
        userId: prompt.authorId,
        actorId: session.user.id,
        promptId,
        commentId,
        read: false,
        createdAt: now,
      } as any);
    }

    // If replying, also notify the parent comment author
    if (parentId) {
      let parentOid: ObjectId;
      try {
        parentOid = new ObjectId(parentId);
      } catch {
        parentOid = new ObjectId();
      }
      const parentComment = await commentsCol().findOne(
        { _id: parentOid },
        { projection: { authorId: 1 } }
      );

      if (
        parentComment &&
        parentComment.authorId !== session.user.id &&
        parentComment.authorId !== prompt.authorId
      ) {
        await notificationsCol().insertOne({
          type: "REPLY",
          userId: parentComment.authorId,
          actorId: session.user.id,
          promptId,
          commentId,
          read: false,
          createdAt: now,
        } as any);
      }
    }

    return NextResponse.json({
      comment: {
        id: commentId,
        content,
        createdAt: now,
        updatedAt: now,
        parentId: parentId ?? null,
        flagged: false,
        author,
        score: 0,
        userVote: 0,
        replyCount: 0,
      },
    });
  } catch (error) {
    console.error("Create comment error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
