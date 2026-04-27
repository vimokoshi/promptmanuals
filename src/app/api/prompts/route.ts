import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, tagsCol } from "@/lib/mongodb";
import type { PromptDocument, EmbeddedTag } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { triggerWebhooks } from "@/lib/webhook";
import { generatePromptEmbedding, findAndSaveRelatedPrompts } from "@/lib/ai/embeddings";
import { generatePromptSlug } from "@/lib/slug";
import { checkPromptQuality } from "@/lib/ai/quality-check";
import { isSimilarContent, normalizeContent } from "@/lib/similarity";
import { formatPromptsForCard } from "@/lib/mongodb/prompt-helpers";

const promptSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
  content: z.string().min(1),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "SKILL", "TASTE"]),
  structuredFormat: z.enum(["JSON", "YAML"]).nullish(),
  categoryId: z.string().optional(),
  tagIds: z.array(z.string()),
  contributorIds: z.array(z.string()).optional(),
  isPrivate: z.boolean(),
  mediaUrl: z.string().url().optional().or(z.literal("")),
  requiresMediaUpload: z.boolean().optional(),
  requiredMediaType: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional(),
  requiredMediaCount: z.number().int().min(1).max(10).optional(),
  bestWithModels: z.array(z.string()).max(3).optional(),
  bestWithMCP: z.array(z.object({
    command: z.string(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  workflowLink: z.string().url().optional().or(z.literal("")),
});

// Create prompt
export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const parsed = promptSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const {
      title, description, content, type, structuredFormat,
      categoryId, tagIds, isPrivate, mediaUrl,
      requiresMediaUpload, requiredMediaType, requiredMediaCount,
      bestWithModels, bestWithMCP, workflowLink,
    } = parsed.data;

    const userId = session.user.id;

    // Check if user is flagged (for auto-delisting and daily limit)
    const currentUser = await usersCol().findOne(
      { _id: new ObjectId(userId) },
      { projection: { flagged: 1 } }
    );
    const isUserFlagged = currentUser?.flagged ?? false;

    // Daily limit for flagged users: 5 prompts per day
    if (isUserFlagged) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const todayPromptCount = await promptsCol().countDocuments({
        authorId: userId,
        createdAt: { $gte: startOfDay },
      });

      if (todayPromptCount >= 5) {
        return NextResponse.json(
          { error: "daily_limit", message: "You have reached the daily limit of 5 prompts" },
          { status: 429 }
        );
      }
    }

    // Rate limit: check if user created a prompt in the last 30 seconds
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
    const recentPrompt = await promptsCol().findOne(
      { authorId: userId, createdAt: { $gte: thirtySecondsAgo } },
      { projection: { _id: 1 } }
    );

    if (recentPrompt) {
      return NextResponse.json(
        { error: "rate_limit", message: "Please wait 30 seconds before creating another prompt" },
        { status: 429 }
      );
    }

    // Check for duplicate title or content from the same user
    const userDuplicate = await promptsCol().findOne({
      authorId: userId,
      deletedAt: null,
      $or: [
        { title: { $regex: `^${title}$`, $options: "i" } },
        { content },
      ],
    });

    if (userDuplicate) {
      return NextResponse.json(
        {
          error: "duplicate_prompt",
          message: "You already have a prompt with the same title or content",
          existingPromptId: userDuplicate._id.toHexString(),
          existingPromptSlug: userDuplicate.slug,
        },
        { status: 409 }
      );
    }

    // Check for similar content system-wide (any user)
    const normalizedNewContent = normalizeContent(content);

    if (normalizedNewContent.length > 50) {
      const publicPrompts = await promptsCol()
        .find({ deletedAt: null, isPrivate: false })
        .sort({ createdAt: -1 })
        .limit(1000)
        .project({ _id: 1, title: 1, content: 1, slug: 1, authorId: 1 })
        .toArray();

      const similarPrompt = publicPrompts.find(p => isSimilarContent(content, p.content as string));

      if (similarPrompt) {
        // Look up author username for the response
        let authorUsername: string | null = null;
        try {
          const similarAuthor = await usersCol().findOne(
            { _id: new ObjectId(similarPrompt.authorId as string) },
            { projection: { username: 1 } }
          );
          authorUsername = similarAuthor?.username ?? null;
        } catch {
          // ignore lookup failure
        }

        return NextResponse.json(
          {
            error: "content_exists",
            message: "A prompt with similar content already exists",
            existingPromptId: (similarPrompt._id as ObjectId).toHexString(),
            existingPromptSlug: similarPrompt.slug,
            existingPromptTitle: similarPrompt.title,
            existingPromptAuthor: authorUsername,
          },
          { status: 409 }
        );
      }
    }

    // Generate slug from title
    const slug = await generatePromptSlug(title);

    // Resolve tags into embedded tag shape
    const tagObjectIds = tagIds.map(id => {
      try { return new ObjectId(id); } catch { return null; }
    }).filter(Boolean) as ObjectId[];

    const tagDocs = tagObjectIds.length > 0
      ? await tagsCol().find({ _id: { $in: tagObjectIds } } as Record<string, unknown>).toArray()
      : [];

    const embeddedTags: EmbeddedTag[] = tagDocs.map(t => ({
      _id: t._id.toHexString(),
      name: t.name,
      slug: t.slug,
      color: t.color,
    }));

    const newId = new ObjectId();

    const promptDoc: PromptDocument = {
      _id: newId,
      title,
      slug,
      description: description ?? null,
      content,
      type,
      structuredFormat: structuredFormat ?? null,
      isPrivate,
      isUnlisted: isUserFlagged,
      unlistedAt: isUserFlagged ? new Date() : null,
      delistReason: isUserFlagged ? "UNUSUAL_ACTIVITY" : null,
      deletedAt: null,
      authorId: userId,
      categoryId: categoryId ?? null,
      mediaUrl: mediaUrl || null,
      requiresMediaUpload: requiresMediaUpload ?? false,
      requiredMediaType: requiresMediaUpload ? (requiredMediaType ?? null) : null,
      requiredMediaCount: requiresMediaUpload ? (requiredMediaCount ?? null) : null,
      bestWithModels: bestWithModels ?? [],
      bestWithMCP: bestWithMCP
        ? bestWithMCP.map(m => ({ command: m.command, tools: m.tools ?? [] }))
        : null,
      workflowLink: workflowLink || null,
      tags: embeddedTags,
      votes: [],
      voteCount: 0,
      versions: [],
      userExamples: [],
      reports: [],
      embedding: null,
      flagged: false,
      flaggedAt: null,
      flaggedBy: null,
      featuredAt: null,
      isFeatured: false,
      viewCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      translations: null,
      seoMeta: null,
    };

    await promptsCol().insertOne(promptDoc);

    // Create initial version (embedded in the prompt document)
    await promptsCol().updateOne(
      { _id: newId },
      {
        $push: {
          versions: {
            _id: new ObjectId().toHexString(),
            version: 1,
            content,
            changeNote: "Initial version",
            createdBy: userId,
            createdAt: new Date(),
          },
        },
      } as Record<string, unknown>
    );

    const insertedDoc = await promptsCol().findOne({ _id: newId });
    const [formatted] = insertedDoc ? await formatPromptsForCard([insertedDoc]) : [];

    // Trigger webhooks for new prompt (non-blocking)
    if (!isPrivate && formatted) {
      triggerWebhooks("PROMPT_CREATED", {
        id: formatted.id,
        title: formatted.title,
        description: formatted.description,
        content: formatted.content,
        type: formatted.type,
        mediaUrl: formatted.mediaUrl,
        isPrivate: formatted.isPrivate,
        author: formatted.author,
        category: formatted.category,
        tags: formatted.tags,
      });
    }

    // Generate embedding for AI search (non-blocking)
    if (!isPrivate) {
      generatePromptEmbedding(newId.toHexString())
        .then(() => findAndSaveRelatedPrompts(newId.toHexString()))
        .catch((err) =>
          console.error("Failed to generate embedding/related prompts for:", newId.toHexString(), err)
        );
    }

    // Run quality check for auto-delist (non-blocking)
    if (!isPrivate) {
      console.log(`[Quality Check] Starting check for prompt ${newId.toHexString()}`);
      checkPromptQuality(title, content, description).then(async (result) => {
        console.log(`[Quality Check] Result for prompt ${newId.toHexString()}:`, JSON.stringify(result));
        if (result.shouldDelist && result.reason) {
          console.log(`[Quality Check] Auto-delisting prompt ${newId.toHexString()}: ${result.reason} - ${result.details}`);
          await promptsCol().updateOne(
            { _id: newId },
            {
              $set: {
                isUnlisted: true,
                unlistedAt: new Date(),
                delistReason: result.reason,
              },
            }
          );
          console.log(`[Quality Check] Prompt ${newId.toHexString()} delisted successfully`);
        }
      }).catch((err) => {
        console.error("[Quality Check] Failed to run quality check for prompt:", newId.toHexString(), err);
      });
    } else {
      console.log(`[Quality Check] Skipped - prompt ${newId.toHexString()} is private`);
    }

    // Revalidate caches
    revalidateTag("prompts");
    revalidateTag("categories");
    revalidateTag("tags");

    return NextResponse.json(formatted ?? { id: newId.toHexString() });
  } catch (error) {
    console.error("Create prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// List prompts (for API access)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const perPage = parseInt(searchParams.get("perPage") || "24");
    const type = searchParams.get("type");
    const categoryId = searchParams.get("category");
    const tag = searchParams.get("tag");
    const sort = searchParams.get("sort");
    const q = searchParams.get("q");

    const filter: Record<string, unknown> = {
      isPrivate: false,
      isUnlisted: false,
      deletedAt: null,
    };

    if (type) {
      filter.type = type;
    }

    if (categoryId) {
      filter.categoryId = categoryId;
    }

    if (tag) {
      const tagSlugs = tag.split(",").map(t => t.trim()).filter(Boolean);
      if (tagSlugs.length === 1) {
        filter["tags.slug"] = tagSlugs[0];
      } else if (tagSlugs.length > 1) {
        filter["tags.slug"] = { $in: tagSlugs };
      }
    }

    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: "i" } },
        { content: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sortQuery: any = { createdAt: -1 };
    if (sort === "oldest") {
      sortQuery = { createdAt: 1 };
    } else if (sort === "upvotes") {
      sortQuery = { voteCount: -1 };
    }

    const [docs, total] = await Promise.all([
      promptsCol()
        .find(filter)
        .sort(sortQuery)
        .skip((page - 1) * perPage)
        .limit(perPage)
        .toArray(),
      promptsCol().countDocuments(filter),
    ]);

    const prompts = await formatPromptsForCard(docs);

    return NextResponse.json({
      prompts,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  } catch (error) {
    console.error("List prompts error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
