import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// DELETE - Hard delete a prompt (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }

    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "forbidden", message: "Admin access required" },
        { status: 403 }
      );
    }

    const { id } = await params;

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "invalid_request", message: "Valid prompt ID is required" },
        { status: 400 }
      );
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const prompt = await promptsCol().findOne(
      { _id: objectId },
      { projection: { title: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    await promptsCol().deleteOne({ _id: objectId });

    return NextResponse.json({
      success: true,
      message: "Prompt deleted successfully",
      deletedPrompt: {
        id: prompt._id.toHexString(),
        title: prompt.title,
      },
    });
  } catch (error) {
    console.error("Admin delete prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Failed to delete prompt" },
      { status: 500 }
    );
  }
}
