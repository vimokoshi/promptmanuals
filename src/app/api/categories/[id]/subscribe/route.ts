import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { categorySubscriptionsCol, categoriesCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// POST - Subscribe to a category
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: categoryId } = await params;
    const userId = session.user.id;

    // Check if category exists
    const categoryObjectId = /^[0-9a-fA-F]{24}$/.test(categoryId)
      ? new ObjectId(categoryId)
      : null;

    if (!categoryObjectId) {
      return NextResponse.json(
        { error: "not_found", message: "Category not found" },
        { status: 404 }
      );
    }

    const category = await categoriesCol().findOne({ _id: categoryObjectId });

    if (!category) {
      return NextResponse.json(
        { error: "not_found", message: "Category not found" },
        { status: 404 }
      );
    }

    // Check if already subscribed
    const existing = await categorySubscriptionsCol().findOne({ userId, categoryId });

    if (existing) {
      return NextResponse.json(
        { error: "already_subscribed", message: "Already subscribed to this category" },
        { status: 400 }
      );
    }

    // Create subscription
    await categorySubscriptionsCol().insertOne({
      _id: new ObjectId(),
      userId,
      categoryId,
      createdAt: new Date(),
    });

    return NextResponse.json({
      subscribed: true,
      category: {
        id: category._id.toHexString(),
        name: category.name,
        slug: category.slug,
      },
    });
  } catch (error) {
    console.error("Subscribe error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// DELETE - Unsubscribe from a category
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: categoryId } = await params;

    // Delete subscription
    await categorySubscriptionsCol().deleteOne({
      userId: session.user.id,
      categoryId,
    });

    return NextResponse.json({ subscribed: false });
  } catch (error) {
    console.error("Unsubscribe error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
