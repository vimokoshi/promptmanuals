import { NextRequest, NextResponse } from "next/server";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { UserDocument, CategoryDocument } from "@/lib/mongodb";
import crypto from "crypto";

function getUserIdentifier(user: {
  username: string;
  githubUsername: string | null;
}): string {
  return user.githubUsername || user.username;
}

const CONTENT_PREVIEW_LENGTH = 500;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const dynamic = "force-dynamic";
export const revalidate = 3600;

function generateETag(count: number, latestUpdatedAt: Date | null): string {
  const raw = `${count}-${latestUpdatedAt?.toISOString() ?? "none"}`;
  const hash = crypto.createHash("md5").update(raw).digest("hex");
  return `"${hash}"`;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const fullContent = searchParams.get("full_content") === "true";
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit");

    const isPaginated = pageParam !== null || limitParam !== null;

    const page = Math.max(1, parseInt(pageParam ?? "1", 10) || 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
    );

    const whereClause = {
      isPrivate: false,
      isUnlisted: false,
      deletedAt: null,
    };

    // Fetch total count and latest updatedAt for ETag generation
    const [totalCount, latestPrompt] = await Promise.all([
      promptsCol().countDocuments(whereClause),
      promptsCol()
        .find(whereClause)
        .sort({ updatedAt: -1 })
        .limit(1)
        .project({ updatedAt: 1 })
        .toArray()
        .then(arr => arr[0] ?? null),
    ]);

    // Generate and check ETag for conditional requests
    const etag = generateETag(totalCount, latestPrompt?.updatedAt ?? null);
    const ifNoneMatch = request.headers.get("If-None-Match");

    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control":
            "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    const query = promptsCol().find(whereClause).sort({ createdAt: -1 });

    if (isPaginated) {
      query.skip((page - 1) * limit).limit(limit);
    }

    const docs = await query.toArray();

    if (docs.length === 0) {
      const responseBody = isPaginated
        ? { count: 0, page, limit, totalPages: 1, hasMore: false, prompts: [] }
        : { count: 0, prompts: [] };
      return NextResponse.json(responseBody, {
        headers: {
          "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
          ETag: etag,
        },
      });
    }

    // Batch-fetch authors
    const authorIds = [...new Set(docs.map(d => d.authorId))];
    const authorDocs = await usersCol()
      .find({ _id: { $in: authorIds } } as Record<string, unknown>)
      .project({ _id: 1, username: 1, name: 1, avatar: 1, githubUsername: 1, verified: 1 })
      .toArray();
    const authorMap = new Map<string, UserDocument>(
      authorDocs.map(u => [(u._id as ObjectId).toHexString(), u as unknown as UserDocument])
    );

    // Batch-fetch categories
    const categoryIds = [
      ...new Set(docs.map(d => d.categoryId).filter(Boolean)),
    ] as string[];
    const categoryDocs = categoryIds.length > 0
      ? await categoriesCol()
          .find({ _id: { $in: categoryIds } } as Record<string, unknown>)
          .project({ _id: 1, name: 1, slug: 1, icon: 1 })
          .toArray()
      : [];
    const categoryMap = new Map<string, CategoryDocument>(
      categoryDocs.map(c => [(c._id as ObjectId).toHexString(), c as unknown as CategoryDocument])
    );

    const formattedPrompts = docs.map(doc => {
      const id = doc._id.toHexString();
      const content = doc.content ?? "";
      const contentPreview =
        content.length > CONTENT_PREVIEW_LENGTH
          ? content.slice(0, CONTENT_PREVIEW_LENGTH) + "..."
          : content;

      const author = authorMap.get(doc.authorId);
      const category = doc.categoryId ? categoryMap.get(doc.categoryId) ?? null : null;

      return {
        id,
        title: doc.title,
        slug: doc.slug,
        description: doc.description,
        ...(fullContent ? { content, contentPreview } : { contentPreview }),
        type: doc.type,
        structuredFormat: doc.structuredFormat,
        mediaUrl: doc.mediaUrl,
        viewCount: doc.viewCount,
        voteCount: doc.voteCount,
        commentCount: 0,
        isFeatured: doc.isFeatured,
        featuredAt: doc.featuredAt,
        requiresMediaUpload: doc.requiresMediaUpload,
        requiredMediaType: doc.requiredMediaType,
        requiredMediaCount: doc.requiredMediaCount,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        category: category
          ? {
              id: (category._id as ObjectId).toHexString(),
              name: category.name,
              slug: category.slug,
              icon: category.icon,
            }
          : null,
        author: author
          ? {
              username: author.username,
              name: author.name,
              avatar: author.avatar,
              identifier: getUserIdentifier(author),
              verified: author.verified,
            }
          : {
              username: doc.authorId,
              name: null,
              avatar: null,
              identifier: doc.authorId,
              verified: false,
            },
        contributors: [],
        tags: doc.tags.map(t => ({
          id: t._id,
          name: t.name,
          slug: t.slug,
          color: t.color,
        })),
      };
    });

    const totalPages = isPaginated ? Math.ceil(totalCount / limit) : 1;

    const responseBody = isPaginated
      ? {
          count: totalCount,
          page,
          limit,
          totalPages,
          hasMore: page < totalPages,
          prompts: formattedPrompts,
        }
      : {
          count: formattedPrompts.length,
          prompts: formattedPrompts,
        };

    return NextResponse.json(responseBody, {
      headers: {
        "Cache-Control":
          "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
        ETag: etag,
      },
    });
  } catch (error) {
    console.error("prompts.json error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
