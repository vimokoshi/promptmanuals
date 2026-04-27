import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { commentsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { getConfig } from "@/lib/config";

// DELETE - Delete a comment (author or admin only)
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

    const { id: promptId, commentId } = await params;

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
      { projection: { _id: 1, promptId: 1, authorId: 1 } }
    );

    if (!comment || comment.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Comment not found" },
        { status: 404 }
      );
    }

    const isAuthor = comment.authorId === session.user.id;
    const isAdmin = session.user.role === "ADMIN";

    if (!isAuthor && !isAdmin) {
      return NextResponse.json(
        { error: "forbidden", message: "You cannot delete this comment" },
        { status: 403 }
      );
    }

    // Soft delete
    await commentsCol().updateOne(
      { _id: commentOid },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } }
    );

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Delete comment error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
