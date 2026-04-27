import { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { InfinitePromptList } from "@/components/prompts/infinite-prompt-list";
import { promptsCol, promptConnectionsCol } from "@/lib/mongodb";
import { formatPromptsForCard } from "@/lib/mongodb/prompt-helpers";

export const metadata: Metadata = {
  title: "Workflows",
  description: "Browse prompts with sequential flows and connections",
};

// Query for workflows list (cached)
function getCachedWorkflows(
  sort: { field: string; order: 1 | -1 },
  perPage: number,
  searchQuery?: string
) {
  const cacheKey = JSON.stringify({ sort, perPage, searchQuery });

  return unstable_cache(
    async () => {
      // Find prompt IDs that are workflow roots:
      // - have at least one outgoing non-"related" connection (sourceId)
      // - are NOT the target of any non-"related" connection (no incoming)
      const [outgoingConnections, incomingConnections] = await Promise.all([
        promptConnectionsCol()
          .find({ label: { $ne: "related" } })
          .project({ sourceId: 1, targetId: 1 })
          .toArray(),
        promptConnectionsCol()
          .find({ label: { $ne: "related" } })
          .project({ targetId: 1 })
          .toArray(),
      ]);

      const sourceIds = new Set(outgoingConnections.map((c) => c.sourceId));
      const targetIds = new Set(incomingConnections.map((c) => c.targetId));

      // Root prompts: have outgoing connections but are not someone else's target
      const rootIds = [...sourceIds].filter((id) => !targetIds.has(id));

      if (rootIds.length === 0) {
        return { workflows: [], total: 0 };
      }

      const baseFilter: Record<string, unknown> = {
        _id: { $in: rootIds },
        isPrivate: false,
        isUnlisted: false,
        deletedAt: null,
        type: { $ne: "SKILL" },
      };

      if (searchQuery) {
        baseFilter.$or = [
          { title: { $regex: searchQuery, $options: "i" } },
          { content: { $regex: searchQuery, $options: "i" } },
          { description: { $regex: searchQuery, $options: "i" } },
        ];
      }

      const [docs, totalCount] = await Promise.all([
        promptsCol()
          .find(baseFilter)
          .sort({ [sort.field]: sort.order })
          .limit(perPage)
          .toArray(),
        promptsCol().countDocuments(baseFilter),
      ]);

      const workflows = await formatPromptsForCard(docs);

      return { workflows, total: totalCount };
    },
    ["workflows", cacheKey],
    { tags: ["prompts", "connections"] }
  )();
}

interface WorkflowsPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
  }>;
}

export default async function WorkflowsPage({ searchParams }: WorkflowsPageProps) {
  const t = await getTranslations("workflows");
  const tNav = await getTranslations("nav");
  const tSearch = await getTranslations("search");
  const params = await searchParams;
  
  const perPage = 24;

  // Build sort for MongoDB
  let sort: { field: string; order: 1 | -1 } = { field: "createdAt", order: -1 };
  if (params.sort === "oldest") {
    sort = { field: "createdAt", order: 1 };
  } else if (params.sort === "upvotes") {
    sort = { field: "voteCount", order: -1 };
  }

  const result = await getCachedWorkflows(sort, perPage, params.q);
  const workflows = result.workflows;
  const total = result.total;

  return (
    <div className="container py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{tNav("workflows")}</h1>
          <span className="text-xs text-muted-foreground">{tSearch("found", { count: total })}</span>
        </div>
      </div>
      
      <p className="text-sm text-muted-foreground mb-6">
        {t("description")}
      </p>

      <InfinitePromptList
        initialPrompts={workflows}
        initialTotal={total}
        filters={{
          q: params.q,
          sort: params.sort,
        }}
      />
    </div>
  );
}
