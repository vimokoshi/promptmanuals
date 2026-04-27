import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { categoriesCol } from "@/lib/mongodb";
import type { CategoryDocument } from "@/lib/mongodb";

// Create category
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, slug, description, icon, parentId, pinned } = body;

    if (!name || !slug) {
      return NextResponse.json({ error: "Name and slug are required" }, { status: 400 });
    }

    const doc: Omit<CategoryDocument, "_id"> = {
      name,
      slug,
      description: description || null,
      icon: icon || null,
      order: 0,
      pinned: pinned || false,
      parentId: parentId || null,
    };

    const result = await categoriesCol().insertOne(doc as CategoryDocument);

    revalidateTag("categories", "max");

    return NextResponse.json({ ...doc, id: result.insertedId.toHexString(), _id: result.insertedId });
  } catch (error) {
    console.error("Error creating category:", error);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
