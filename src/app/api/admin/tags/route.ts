import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { tagsCol } from "@/lib/mongodb";
import type { TagDocument } from "@/lib/mongodb";

// Create tag
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, slug, color } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
    }

    const doc: Omit<TagDocument, "_id"> = {
      name,
      slug,
      color: color || "#6366f1",
    };

    const result = await tagsCol().insertOne(doc as TagDocument);

    return NextResponse.json({ ...doc, id: result.insertedId.toHexString(), _id: result.insertedId });
  } catch (error) {
    console.error("Error creating tag:", error);
    return NextResponse.json({ error: "Failed to create tag" }, { status: 500 });
  }
}
