import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, categoriesCol, tagsCol, promptConnectionsCol } from "@/lib/mongodb";
import type { EmbeddedTag } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generatePromptEmbedding, findAndSaveRelatedPrompts } from "@/lib/ai/embeddings";
import { generatePromptSlug } from "@/lib/slug";
import { checkPromptQuality } from "@/lib/ai/quality-check";

const updatePromptSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(500).optional(),
  content: z.string().min(1).optional(),
  type: z.enum(["TEXT", "IMAGE", "VIDEO", "AUDIO", "SKILL", "TASTE"]).optional(),
  structuredFormat: z.enum(["JSON", "YAML"]).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  tagIds: z.array(z.string()).optional(),
  contributorIds: z.array(z.string()).optional(),
  isPrivate: z.boolean().optional(),
  mediaUrl: z.string().url().optional().or(z.literal("")).nullable(),
  requiresMediaUpload: z.boolean().optional(),
  requiredMediaType: z.enum(["IMAGE", "VIDEO", "DOCUMENT"]).optional().nullable(),
  requiredMediaCount: z.number().int().min(1).max(10).optional().nullable(),
  bestWithModels: z.array(z.string()).max(3).optional(),
  bestWithMCP: z.array(z.object({
    command: z.string(),
    tools: z.array(z.string()).optional(),
  })).optional(),
  workflowLink: z.string().url().optional().or(z.literal("")).nullable(),
});

// Get single prompt
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await auth();

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const prompt = await promptsCol().findOne({ _id: objectId });

    if (!prompt || prompt.deletedAt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Check if user can view private prompt
    if (prompt.isPrivate && prompt.authorId !== session?.user?.id) {
      return NextResponse.json(
        { error: "forbidden", message: "This prompt is private" },
        { status: 403 }
      );
    }

    // Resolve author and category in parallel
    const [author, category] = await Promise.all([
      usersCol().findOne(
        { _id: new ObjectId(prompt.authorId) },
        { projection: { name: 1, username: 1, avatar: 1, verified: 1 } }
      ),
      prompt.categoryId
        ? categoriesCol().findOne({ _id: new ObjectId(prompt.categoryId) })
        : Promise.resolve(null),
    ]);

    // Check if logged-in user has voted
    let hasVoted = false;
    if (session?.user?.id) {
      hasVoted = prompt.votes.some((v) => v.userId === session.user!.id);
    }

    // Build versions (up to 10 most recent, sorted desc)
    const versions = [...(prompt.versions ?? [])]
      .sort((a, b) => b.version - a.version)
      .slice(0, 10);

    // Omit embedding from response
    const { embedding: _embedding, votes: _votes, ...rest } = prompt;

    return NextResponse.json({
      ...rest,
      id: prompt._id.toHexString(),
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
            ...category,
            id: category._id.toHexString(),
            parent: null, // CategoryDocument has no parent field embedded; extend if needed
          }
        : null,
      tags: prompt.tags,
      versions,
      voteCount: prompt.voteCount,
      hasVoted,
    });
  } catch (error) {
    console.error("Get prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// Update prompt
export async function PATCH(
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

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const existing = await promptsCol().findOne(
      { _id: objectId },
      { projection: { authorId: 1, content: 1, versions: 1, title: 1, description: 1, isPrivate: 1, isUnlisted: 1 } }
    );

    if (!existing) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (existing.authorId !== session.user.id && session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "forbidden", message: "You can only edit your own prompts" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = updatePromptSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { tagIds, contributorIds: _contributorIds, categoryId, mediaUrl, title, bestWithModels, bestWithMCP, workflowLink, ...data } = parsed.data;

    // Regenerate slug if title changed
    let newSlug: string | undefined;
    if (title) {
      newSlug = await generatePromptSlug(title);
    }

    // Resolve embedded tags if tagIds provided
    let embeddedTags: EmbeddedTag[] | undefined;
    if (tagIds !== undefined) {
      if (tagIds.length > 0) {
        const tagObjectIds = tagIds.map((tid) => {
          try { return new ObjectId(tid); } catch { return null; }
        }).filter((t): t is ObjectId => t !== null);

        const tagDocs = tagObjectIds.length
          ? await tagsCol().find({ _id: { $in: tagObjectIds } }).toArray()
          : [];

        embeddedTags = tagDocs.map((t) => ({
          _id: t._id.toHexString(),
          name: t.name,
          slug: t.slug,
          color: t.color,
        }));
      } else {
        embeddedTags = [];
      }
    }

    // Build update fields
    const updateFields: Record<string, unknown> = {
      ...data,
      updatedAt: new Date(),
    };

    if (title) updateFields.title = title;
    if (newSlug) updateFields.slug = newSlug;
    if (categoryId !== undefined) updateFields.categoryId = categoryId || null;
    if (mediaUrl !== undefined) updateFields.mediaUrl = mediaUrl || null;
    if (bestWithModels !== undefined) updateFields.bestWithModels = bestWithModels;
    if (bestWithMCP !== undefined) updateFields.bestWithMCP = bestWithMCP;
    if (workflowLink !== undefined) updateFields.workflowLink = workflowLink || null;
    if (embeddedTags !== undefined) updateFields.tags = embeddedTags;

    // Create new version if content changed
    if (data.content && data.content !== existing.content) {
      const latestVersion = existing.versions?.reduce(
        (max, v) => (v.version > max ? v.version : max),
        0
      ) ?? 0;

      const newVersion = {
        _id: new ObjectId().toHexString(),
        version: latestVersion + 1,
        content: data.content,
        changeNote: "Content updated",
        createdAt: new Date(),
        createdBy: session.user.id,
      };

      updateFields.$push = { versions: newVersion };
    }

    // Extract $push before using $set
    const pushOp = updateFields.$push as Record<string, unknown> | undefined;
    delete updateFields.$push;

    const mongoUpdate: Record<string, unknown> = { $set: updateFields };
    if (pushOp) mongoUpdate.$push = pushOp;

    const updatedPrompt = await promptsCol().findOneAndUpdate(
      { _id: objectId },
      mongoUpdate,
      { returnDocument: "after" }
    );

    if (!updatedPrompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Resolve author and category for response
    const [author, category] = await Promise.all([
      usersCol().findOne(
        { _id: new ObjectId(updatedPrompt.authorId) },
        { projection: { name: 1, username: 1 } }
      ),
      updatedPrompt.categoryId
        ? categoriesCol().findOne({ _id: new ObjectId(updatedPrompt.categoryId) })
        : Promise.resolve(null),
    ]);

    // Regenerate embedding if content, title, or description changed (non-blocking)
    const contentChanged = data.content || title || data.description !== undefined;
    if (contentChanged && !updatedPrompt.isPrivate) {
      generatePromptEmbedding(id)
        .then(() => findAndSaveRelatedPrompts(id))
        .catch((err) =>
          console.error("Failed to regenerate embedding/related prompts for:", id, err)
        );
    }

    // Run quality check for auto-delist on content changes (non-blocking)
    if (contentChanged && !updatedPrompt.isPrivate && !updatedPrompt.isUnlisted) {
      const checkTitle = title || updatedPrompt.title;
      const checkContent = data.content || updatedPrompt.content;
      const checkDescription = data.description !== undefined ? data.description : updatedPrompt.description;

      console.log(`[Quality Check] Starting check for updated prompt ${id}`);
      checkPromptQuality(checkTitle, checkContent, checkDescription).then(async (result) => {
        console.log(`[Quality Check] Result for prompt ${id}:`, JSON.stringify(result));
        if (result.shouldDelist && result.reason) {
          console.log(`[Quality Check] Auto-delisting prompt ${id}: ${result.reason} - ${result.details}`);
          await promptsCol().updateOne(
            { _id: objectId },
            {
              $set: {
                isUnlisted: true,
                unlistedAt: new Date(),
                delistReason: result.reason,
                updatedAt: new Date(),
              },
            }
          );
          console.log(`[Quality Check] Prompt ${id} delisted successfully`);
        }
      }).catch((err) => {
        console.error("[Quality Check] Failed to run quality check for prompt:", id, err);
      });
    }

    // Propagate workflow link to all prompts in the same workflow chain (non-related)
    if (workflowLink !== undefined) {
      const newWorkflowLink = workflowLink || null;

      const allFlowConnections = await promptConnectionsCol()
        .find({ label: { $ne: "related" } }, { projection: { sourceId: 1, targetId: 1 } })
        .toArray();

      const adjacency = new Map<string, Set<string>>();
      allFlowConnections.forEach((conn) => {
        if (!adjacency.has(conn.sourceId)) adjacency.set(conn.sourceId, new Set());
        if (!adjacency.has(conn.targetId)) adjacency.set(conn.targetId, new Set());
        adjacency.get(conn.sourceId)!.add(conn.targetId);
        adjacency.get(conn.targetId)!.add(conn.sourceId);
      });

      const workflowPromptIds = new Set<string>();
      const queue = [id];
      workflowPromptIds.add(id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = adjacency.get(current);
        if (neighbors) {
          neighbors.forEach((neighborId) => {
            if (!workflowPromptIds.has(neighborId)) {
              workflowPromptIds.add(neighborId);
              queue.push(neighborId);
            }
          });
        }
      }

      workflowPromptIds.delete(id);

      if (workflowPromptIds.size > 0) {
        const neighborObjectIds = [...workflowPromptIds].map((nid) => {
          try { return new ObjectId(nid); } catch { return null; }
        }).filter((o): o is ObjectId => o !== null);

        if (neighborObjectIds.length > 0) {
          await promptsCol().updateMany(
            { _id: { $in: neighborObjectIds } },
            { $set: { workflowLink: newWorkflowLink, updatedAt: new Date() } }
          );
        }
      }
    }

    // Revalidate caches
    revalidateTag("prompts");
    revalidateTag("prompt-flow");

    const { embedding: _embedding, ...responsePrompt } = updatedPrompt;
    return NextResponse.json({
      ...responsePrompt,
      id: updatedPrompt._id.toHexString(),
      author: author
        ? { id: author._id.toHexString(), name: author.name, username: author.username }
        : null,
      category: category
        ? { id: category._id.toHexString(), name: category.name, slug: category.slug, parent: null }
        : null,
      tags: updatedPrompt.tags,
    });
  } catch (error) {
    console.error("Update prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// Soft delete prompt
// - Admins can delete any prompt
// - Owners can delete their own delisted prompts (auto-delisted for quality issues)
export async function DELETE(
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

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    const existing = await promptsCol().findOne(
      { _id: objectId },
      { projection: { deletedAt: 1, authorId: 1, isUnlisted: 1, delistReason: 1 } }
    );

    if (!existing) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (existing.deletedAt) {
      return NextResponse.json(
        { error: "already_deleted", message: "Prompt is already deleted" },
        { status: 400 }
      );
    }

    const isAdmin = session.user.role === "ADMIN";
    const isOwner = existing.authorId === session.user.id;
    const isDelisted = existing.isUnlisted && existing.delistReason;

    if (!isAdmin && !(isOwner && isDelisted)) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: isOwner
            ? "You can only delete prompts that have been delisted for quality issues. Contact an admin for other deletions."
            : "Prompts are released under CC0 and cannot be deleted. Contact an admin if there is an issue.",
        },
        { status: 403 }
      );
    }

    await promptsCol().updateOne(
      { _id: objectId },
      { $set: { deletedAt: new Date(), updatedAt: new Date() } }
    );

    // Revalidate caches
    revalidateTag("prompts");
    revalidateTag("categories");
    revalidateTag("tags");
    revalidateTag("prompt-flow");

    return NextResponse.json({
      success: true,
      message: isOwner && isDelisted
        ? "Delisted prompt deleted successfully"
        : "Prompt soft deleted",
    });
  } catch (error) {
    console.error("Delete prompt error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
