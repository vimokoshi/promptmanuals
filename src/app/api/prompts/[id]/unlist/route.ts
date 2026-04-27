import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";

// Toggle unlist status (admin only)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    // Only admins can unlist prompts
    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "forbidden", message: "Only admins can unlist prompts" },
        { status: 403 }
      );
    }

    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Check if prompt exists
    const existing = await promptsCol().findOne(
      { _id: oid },
      { projection: { isUnlisted: 1 } }
    );

    if (!existing) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Toggle unlist status
    const newUnlistedStatus = !existing.isUnlisted;

    await promptsCol().updateOne(
      { _id: oid },
      {
        $set: {
          isUnlisted: newUnlistedStatus,
          unlistedAt: newUnlistedStatus ? new Date() : null,
          updatedAt: new Date(),
        },
      }
    );

    // Revalidate caches
    revalidateTag("prompts");
    revalidateTag("categories");
    revalidateTag("tags");

    return NextResponse.json({
      success: true,
      isUnlisted: newUnlistedStatus,
      message: newUnlistedStatus ? "Prompt unlisted" : "Prompt relisted",
    });
  } catch (error) {
    console.error("Unlist prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
