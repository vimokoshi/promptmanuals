import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  collectionsCol,
  promptsCol,
  usersCol,
  categoriesCol,
} from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { z } from "zod";

const addToCollectionSchema = z.object({
  promptId: z.string().min(1),
});

export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Fetch all collection entries for the user, sorted newest first
  const collectionDocs = await collectionsCol()
    .find({ userId })
    .sort({ createdAt: -1 })
    .toArray();

  if (collectionDocs.length === 0) {
    return NextResponse.json({ collections: [] });
  }

  const promptIds = collectionDocs.map((c) => c.promptId);

  // Fetch all referenced prompts
  const promptObjectIds = promptIds
    .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
    .map((id) => new ObjectId(id));

  const promptDocs = await promptsCol()
    .find({ _id: { $in: promptObjectIds } })
    .toArray();

  const promptMap = new Map(promptDocs.map((p) => [p._id.toHexString(), p]));

  // Collect author and category IDs for batch lookup
  const authorIds = [
    ...new Set(promptDocs.map((p) => p.authorId).filter(Boolean)),
  ];
  const categoryIds = [
    ...new Set(
      promptDocs.map((p) => p.categoryId).filter((id): id is string => !!id)
    ),
  ];

  const [authorDocs, categoryDocs, parentCategoryDocs] = await Promise.all([
    authorIds.length
      ? usersCol()
          .find(
            {
              _id: {
                $in: authorIds
                  .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
                  .map((id) => new ObjectId(id)),
              },
            },
            {
              projection: {
                _id: 1,
                name: 1,
                username: 1,
                avatar: 1,
                verified: 1,
              },
            }
          )
          .toArray()
      : Promise.resolve([]),
    categoryIds.length
      ? categoriesCol()
          .find({
            _id: {
              $in: categoryIds
                .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
                .map((id) => new ObjectId(id)),
            },
          })
          .toArray()
      : Promise.resolve([]),
    Promise.resolve([]),
  ]);

  const authorMap = new Map(
    authorDocs.map((a) => [a._id.toHexString(), a])
  );
  const categoryMap = new Map(
    categoryDocs.map((c) => [c._id.toHexString(), c])
  );

  // Fetch parent categories
  const parentIds = [
    ...new Set(
      categoryDocs
        .map((c) => c.parentId)
        .filter((id): id is string => !!id)
    ),
  ];

  const parentDocs =
    parentIds.length
      ? await categoriesCol()
          .find({
            _id: {
              $in: parentIds
                .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
                .map((id) => new ObjectId(id)),
            },
          },
          { projection: { _id: 1, name: 1, slug: 1 } })
          .toArray()
      : [];

  const parentMap = new Map(
    parentDocs.map((p) => [p._id.toHexString(), p])
  );

  const collections = collectionDocs.map((col) => {
    const prompt = promptMap.get(col.promptId);
    if (!prompt) return null;

    const author = authorMap.get(prompt.authorId);
    const category = prompt.categoryId
      ? categoryMap.get(prompt.categoryId)
      : null;
    const parent = category?.parentId
      ? parentMap.get(category.parentId)
      : null;

    return {
      id: col._id.toHexString(),
      userId: col.userId,
      promptId: col.promptId,
      createdAt: col.createdAt,
      prompt: {
        id: prompt._id.toHexString(),
        title: prompt.title,
        slug: prompt.slug,
        description: prompt.description,
        content: prompt.content,
        type: prompt.type,
        isPrivate: prompt.isPrivate,
        mediaUrl: prompt.mediaUrl,
        viewCount: prompt.viewCount,
        voteCount: prompt.voteCount,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        authorId: prompt.authorId,
        tags: prompt.tags,
        author: author
          ? {
              id: author._id.toHexString(),
              name: author.name,
              username: author.username,
              avatar: author.avatar,
              verified: author.verified,
            }
          : null,
        category: category
          ? {
              id: category._id.toHexString(),
              name: category.name,
              slug: category.slug,
              parent: parent
                ? {
                    id: parent._id.toHexString(),
                    name: parent.name,
                    slug: parent.slug,
                  }
                : null,
            }
          : null,
        _count: {
          votes: prompt.votes?.length ?? 0,
        },
      },
    };
  }).filter(Boolean);

  return NextResponse.json({ collections });
}

export async function POST(req: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { promptId } = addToCollectionSchema.parse(body);
    const userId = session.user.id;

    const existingCollection = await collectionsCol().findOne({ userId, promptId });

    if (existingCollection) {
      return NextResponse.json({ error: "Already in collection" }, { status: 400 });
    }

    // Verify the prompt exists and check access
    const promptObjectId = /^[0-9a-fA-F]{24}$/.test(promptId)
      ? new ObjectId(promptId)
      : null;

    if (!promptObjectId) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const prompt = await promptsCol().findOne(
      { _id: promptObjectId },
      { projection: { _id: 1, isPrivate: 1, authorId: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    if (prompt.isPrivate && prompt.authorId !== userId) {
      return NextResponse.json({ error: "Cannot add private prompt" }, { status: 403 });
    }

    const now = new Date();
    const result = await collectionsCol().insertOne({
      _id: new ObjectId(),
      userId,
      promptId,
      createdAt: now,
    });

    const collection = {
      id: result.insertedId.toHexString(),
      userId,
      promptId,
      createdAt: now,
    };

    return NextResponse.json({ collection, added: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("Failed to add to collection:", error);
    return NextResponse.json({ error: "Failed to add to collection" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const promptId = searchParams.get("promptId");

    if (!promptId) {
      return NextResponse.json({ error: "promptId required" }, { status: 400 });
    }

    await collectionsCol().deleteOne({
      userId: session.user.id,
      promptId,
    });

    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error("Failed to remove from collection:", error);
    return NextResponse.json({ error: "Failed to remove from collection" }, { status: 500 });
  }
}
