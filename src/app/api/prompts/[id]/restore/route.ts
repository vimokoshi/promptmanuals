import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only admins can restore deleted prompts
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Check if prompt exists and is deleted
    const prompt = await promptsCol().findOne(
      { _id: oid },
      { projection: { deletedAt: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    if (!prompt.deletedAt) {
      return NextResponse.json({ error: "Prompt is not deleted" }, { status: 400 });
    }

    // Restore the prompt by setting deletedAt to null
    await promptsCol().updateOne(
      { _id: oid },
      { $set: { deletedAt: null, updatedAt: new Date() } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Restore prompt error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
