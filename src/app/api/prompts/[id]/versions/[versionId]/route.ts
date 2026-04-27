import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId, versionId } = await params;

    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Check if prompt exists and user is owner
    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { authorId: 1, versions: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (prompt.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "forbidden", message: "You can only delete versions of your own prompts" },
        { status: 403 }
      );
    }

    // Check if version exists in embedded array
    const versions = prompt.versions ?? [];
    const version = versions.find((v) => v._id === versionId);

    if (!version) {
      return NextResponse.json(
        { error: "not_found", message: "Version not found" },
        { status: 404 }
      );
    }

    // Pull version from embedded array
    await promptsCol().updateOne(
      { _id: promptOid },
      { $pull: { versions: { _id: versionId } } as any }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete version error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
