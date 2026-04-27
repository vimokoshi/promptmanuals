import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { unstable_cache } from "next/cache";
import { auth } from "@/lib/auth";
import { promptsCol, promptConnectionsCol, usersCol } from "@/lib/mongodb";

interface FlowNode {
  id: string;
  title: string;
  slug: string | null;
  description: string | null;
  content: string;
  type: string;
  authorId: string;
  authorUsername: string;
  authorAvatar: string | null;
  requiresMediaUpload: boolean;
  requiredMediaType: string | null;
  requiredMediaCount: number | null;
  mediaUrl: string | null;
}

interface FlowEdge {
  source: string;
  target: string;
  label: string;
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

// Cached function to fetch flow data (revalidates on prompt-flow tag)
const getFlowData = unstable_cache(
  async (promptId: string) => {
    // Step 1: Collect all connected prompt IDs using BFS on connections only
    const allPromptIds = new Set<string>([promptId]);
    const allEdges: Array<{
      source: string;
      target: string;
      label: string;
      targetPrivate: boolean;
      targetAuthorId: string;
      sourcePrivate?: boolean;
      sourceAuthorId?: string;
    }> = [];
    const visitedForEdges = new Set<string>();
    const queue: string[] = [promptId];

    // Fetch all connections in batches - much faster than one-by-one
    while (queue.length > 0) {
      const currentBatch = queue.splice(0, queue.length);
      const unvisited = currentBatch.filter((pid) => !visitedForEdges.has(pid));
      if (unvisited.length === 0) break;

      unvisited.forEach((pid) => visitedForEdges.add(pid));

      // Batch fetch connections for all current nodes
      const [outgoing, incoming] = await Promise.all([
        promptConnectionsCol()
          .find({
            sourceId: { $in: unvisited },
            label: { $ne: "related" },
          })
          .toArray(),
        promptConnectionsCol()
          .find({
            targetId: { $in: unvisited },
            label: { $ne: "related" },
          })
          .toArray(),
      ]);

      // We need isPrivate and authorId for target/source prompts — batch fetch them
      const targetIds = outgoing.map((c) => c.targetId);
      const sourceIds = incoming.map((c) => c.sourceId);
      const relatedIds = [...new Set([...targetIds, ...sourceIds])];

      let relatedPrompts: Array<{ _id: ObjectId; isPrivate: boolean; authorId: string; deletedAt: Date | null }> = [];
      if (relatedIds.length > 0) {
        const relatedOids = relatedIds
          .map((rid) => {
            try { return new ObjectId(rid); } catch { return null; }
          })
          .filter((o): o is ObjectId => o !== null);

        relatedPrompts = await promptsCol()
          .find(
            { _id: { $in: relatedOids }, deletedAt: null },
            { projection: { isPrivate: 1, authorId: 1 } }
          )
          .toArray() as Array<{ _id: ObjectId; isPrivate: boolean; authorId: string; deletedAt: Date | null }>;
      }

      const promptMap = new Map(relatedPrompts.map((p) => [p._id.toHexString(), p]));

      // Process outgoing
      for (const conn of outgoing) {
        const target = promptMap.get(conn.targetId);
        if (!target) continue; // target deleted or not found
        allPromptIds.add(conn.targetId);
        allEdges.push({
          source: conn.sourceId,
          target: conn.targetId,
          label: conn.label,
          targetPrivate: target.isPrivate,
          targetAuthorId: target.authorId,
        });
        if (!visitedForEdges.has(conn.targetId)) {
          queue.push(conn.targetId);
        }
      }

      // Process incoming
      for (const conn of incoming) {
        const source = promptMap.get(conn.sourceId);
        if (!source) continue; // source deleted or not found
        allPromptIds.add(conn.sourceId);
        // Only add edge if not already added
        const edgeExists = allEdges.some(
          (e) => e.source === conn.sourceId && e.target === conn.targetId
        );
        if (!edgeExists) {
          allEdges.push({
            source: conn.sourceId,
            target: conn.targetId,
            label: conn.label,
            sourcePrivate: source.isPrivate,
            sourceAuthorId: source.authorId,
            targetPrivate: false,
            targetAuthorId: "",
          });
        }
        if (!visitedForEdges.has(conn.sourceId)) {
          queue.push(conn.sourceId);
        }
      }
    }

    // Step 2: Batch fetch all prompt details in ONE query
    const allOids = Array.from(allPromptIds)
      .map((pid) => {
        try { return new ObjectId(pid); } catch { return null; }
      })
      .filter((o): o is ObjectId => o !== null);

    const prompts = await promptsCol()
      .find(
        { _id: { $in: allOids }, deletedAt: null },
        {
          projection: {
            title: 1,
            slug: 1,
            description: 1,
            content: 1,
            type: 1,
            isPrivate: 1,
            authorId: 1,
            requiresMediaUpload: 1,
            requiredMediaType: 1,
            requiredMediaCount: 1,
            mediaUrl: 1,
          },
        }
      )
      .toArray();

    // Fetch author details for all unique authorIds
    const authorIds = [...new Set(prompts.map((p) => p.authorId))];
    const authorOids = authorIds
      .map((aid) => {
        try { return new ObjectId(aid); } catch { return null; }
      })
      .filter((o): o is ObjectId => o !== null);

    const authors = await usersCol()
      .find(
        { _id: { $in: authorOids } },
        { projection: { username: 1, avatar: 1 } }
      )
      .toArray();

    const authorMap = new Map(authors.map((a) => [a._id.toHexString(), a]));

    // Normalize prompts to include string id and author data
    const normalizedPrompts = prompts.map((p) => {
      const author = authorMap.get(p.authorId) ?? { username: "", avatar: null };
      return {
        id: p._id.toHexString(),
        title: p.title,
        slug: p.slug,
        description: p.description,
        content: p.content,
        type: p.type,
        isPrivate: p.isPrivate,
        authorId: p.authorId,
        authorUsername: (author as { username: string; avatar: string | null }).username,
        authorAvatar: (author as { username: string; avatar: string | null }).avatar,
        requiresMediaUpload: p.requiresMediaUpload,
        requiredMediaType: p.requiredMediaType,
        requiredMediaCount: p.requiredMediaCount,
        mediaUrl: p.mediaUrl,
      };
    });

    return { prompts: normalizedPrompts, allEdges };
  },
  ["prompt-flow"],
  { tags: ["prompt-flow"], revalidate: 60 } // Cache for 60 seconds, revalidate on prompt-flow tag
);

/**
 * Get the full flow graph for a prompt.
 * Optimized: Fetches all connections first, then batch-loads prompts.
 * Cached with "prompt-flow" tag - revalidate when prompts/connections change.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  try {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Get session and prompt check in parallel
    const [prompt, session] = await Promise.all([
      promptsCol().findOne(
        { _id: oid, deletedAt: null },
        { projection: { isPrivate: 1, authorId: 1 } }
      ),
      auth(),
    ]);

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    const userId = session?.user?.id;

    // Helper to check if user can see a prompt
    const canSee = (p: { isPrivate: boolean; authorId: string }) =>
      !p.isPrivate || p.authorId === userId;

    if (!canSee(prompt)) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Get cached flow data
    const { prompts, allEdges } = await getFlowData(id);

    // Build nodes map - filter by visibility
    const nodes: FlowNode[] = prompts
      .filter((p) => canSee(p))
      .map((p) => ({
        id: p.id,
        title: p.title,
        slug: p.slug,
        description: p.description,
        content: p.content,
        type: p.type,
        authorId: p.authorId,
        authorUsername: p.authorUsername,
        authorAvatar: p.authorAvatar,
        requiresMediaUpload: p.requiresMediaUpload,
        requiredMediaType: p.requiredMediaType,
        requiredMediaCount: p.requiredMediaCount,
        mediaUrl: p.mediaUrl,
      }));

    // Filter edges to only include visible nodes
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges: FlowEdge[] = allEdges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, label: e.label }));

    return NextResponse.json({
      nodes,
      edges,
      currentPromptId: id,
    });
  } catch (error) {
    console.error("Failed to fetch flow:", error);
    return NextResponse.json(
      { error: "Failed to fetch flow" },
      { status: 500 }
    );
  }
}
