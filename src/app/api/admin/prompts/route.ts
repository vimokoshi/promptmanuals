import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// GET - List all prompts for admin with pagination and search
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const filter = searchParams.get("filter") || "all";

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    // Build filter query
    const query: Record<string, unknown> = {};

    switch (filter) {
      case "unlisted":
        query.isUnlisted = true;
        break;
      case "private":
        query.isPrivate = true;
        break;
      case "featured":
        query.isFeatured = true;
        break;
      case "deleted":
        query.deletedAt = { $ne: null };
        break;
      case "reported":
        query["reports.0"] = { $exists: true };
        break;
      case "public":
        query.isPrivate = false;
        query.isUnlisted = false;
        query.deletedAt = null;
        break;
      default:
        // "all" - no filter
        break;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { content: { $regex: search, $options: "i" } },
      ];
    }

    // Build sort
    const validSortFields = ["createdAt", "updatedAt", "title", "viewCount"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [prompts, total] = await Promise.all([
      promptsCol()
        .find(query, {
          projection: {
            title: 1,
            slug: 1,
            type: 1,
            isPrivate: 1,
            isUnlisted: 1,
            isFeatured: 1,
            viewCount: 1,
            createdAt: 1,
            updatedAt: 1,
            deletedAt: 1,
            authorId: 1,
            categoryId: 1,
            voteCount: 1,
            "reports": 1,
          },
        })
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(validLimit)
        .toArray(),
      promptsCol().countDocuments(query),
    ]);

    // Resolve authors and categories
    const authorIds = [...new Set(prompts.map((p) => p.authorId).filter(Boolean))];
    const categoryIds = [...new Set(prompts.map((p) => p.categoryId).filter(Boolean) as string[])];

    const [authors, categories] = await Promise.all([
      authorIds.length
        ? usersCol()
            .find(
              { _id: { $in: authorIds.map((id) => new ObjectId(id)) } },
              { projection: { username: 1, name: 1, avatar: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
      categoryIds.length
        ? categoriesCol()
            .find(
              { _id: { $in: categoryIds.map((id) => new ObjectId(id)) } },
              { projection: { name: 1, slug: 1 } }
            )
            .toArray()
        : Promise.resolve([]),
    ]);

    const authorMap = new Map(authors.map((a) => [a._id.toHexString(), a]));
    const categoryMap = new Map(categories.map((c) => [c._id.toHexString(), c]));

    const result = prompts.map((p) => {
      const id = p._id.toHexString();
      const author = p.authorId ? authorMap.get(p.authorId) : null;
      const category = p.categoryId ? categoryMap.get(p.categoryId) : null;
      return {
        id,
        title: p.title,
        slug: p.slug,
        type: p.type,
        isPrivate: p.isPrivate,
        isUnlisted: p.isUnlisted,
        isFeatured: p.isFeatured,
        viewCount: p.viewCount,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        deletedAt: p.deletedAt,
        author: author
          ? {
              id: author._id.toHexString(),
              username: author.username,
              name: author.name,
              avatar: author.avatar,
            }
          : null,
        category: category
          ? {
              id: category._id.toHexString(),
              name: category.name,
              slug: category.slug,
            }
          : null,
        _count: {
          votes: p.voteCount ?? 0,
          reports: (p.reports as unknown[])?.length ?? 0,
        },
      };
    });

    return NextResponse.json({
      prompts: result,
      pagination: {
        page: validPage,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (error) {
    console.error("Admin list prompts error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Failed to fetch prompts" },
      { status: 500 }
    );
  }
}
