import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol } from "@/lib/mongodb";

// POST /api/prompts/[id]/feature - Toggle featured status (admin only)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    let userOid: ObjectId;
    try {
      userOid = new ObjectId(session.user.id);
    } catch {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await usersCol().findOne(
      { _id: userOid },
      { projection: { role: 1 } }
    );

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Get current prompt
    const prompt = await promptsCol().findOne(
      { _id: oid },
      { projection: { isFeatured: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Toggle featured status
    const newFeatured = !prompt.isFeatured;

    await promptsCol().updateOne(
      { _id: oid },
      {
        $set: {
          isFeatured: newFeatured,
          featuredAt: newFeatured ? new Date() : null,
          updatedAt: new Date(),
        },
      }
    );

    return NextResponse.json({
      success: true,
      isFeatured: newFeatured,
    });
  } catch (error) {
    console.error("Error toggling featured status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
