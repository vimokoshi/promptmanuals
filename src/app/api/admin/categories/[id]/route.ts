import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { auth } from "@/lib/auth";
import { categoriesCol, promptsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Update category
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const body = await request.json();
    const { name, slug, description, icon, parentId, pinned } = body;

    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (name) setFields.name = name;
    if (slug) setFields.slug = slug;
    if (description !== undefined) setFields.description = description;
    if (icon !== undefined) setFields.icon = icon;
    if (parentId === null || parentId !== undefined) setFields.parentId = parentId === null ? null : (parentId || null);
    if (typeof pinned === "boolean") setFields.pinned = pinned;

    const updated = await categoriesCol().findOneAndUpdate(
      { _id: objectId },
      { $set: setFields },
      { returnDocument: "after" }
    );

    if (!updated) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    revalidateTag("categories", "max");

    return NextResponse.json({ ...updated, id: updated._id.toHexString() });
  } catch (error) {
    console.error("Error updating category:", error);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

// Delete category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const result = await categoriesCol().deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Nullify categoryId on prompts that referenced this category
    await promptsCol().updateMany({ categoryId: id }, { $set: { categoryId: null } });

    revalidateTag("categories", "max");

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting category:", error);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
