import { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfinitePromptList } from "@/components/prompts/infinite-prompt-list";
import { promptsCol } from "@/lib/mongodb";
import { formatPromptsForCard } from "@/lib/mongodb/prompt-helpers";

export const metadata: Metadata = {
  title: "Skills",
  description: "Browse and discover AI agent skills",
};

// Query for skills list (cached)
function getCachedSkills(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sort: { field: string; order: 1 | -1 },
  perPage: number,
  searchQuery?: string
) {
  const cacheKey = JSON.stringify({ sort, perPage, searchQuery });

  return unstable_cache(
    async () => {
      const filter: Record<string, unknown> = {
        type: "SKILL",
        isPrivate: false,
        isUnlisted: false,
        deletedAt: null,
      };

      if (searchQuery) {
        filter.$or = [
          { title: { $regex: searchQuery, $options: "i" } },
          { content: { $regex: searchQuery, $options: "i" } },
          { description: { $regex: searchQuery, $options: "i" } },
        ];
      }

      const [docs, totalCount] = await Promise.all([
        promptsCol()
          .find(filter)
          .sort({ [sort.field]: sort.order })
          .limit(perPage)
          .toArray(),
        promptsCol().countDocuments(filter),
      ]);

      const skills = await formatPromptsForCard(docs);

      return { skills, total: totalCount };
    },
    ["skills", cacheKey],
    { tags: ["prompts"] }
  )();
}

interface SkillsPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
  }>;
}

export default async function SkillsPage({ searchParams }: SkillsPageProps) {
  const t = await getTranslations("prompts");
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

  const result = await getCachedSkills(sort, perPage, params.q);
  const skills = result.skills;
  const total = result.total;

  return (
    <div className="container py-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-semibold">{tNav("skills")}</h1>
          <span className="text-xs text-muted-foreground">{tSearch("found", { count: total })}</span>
        </div>
        <Button size="sm" className="h-8 text-xs w-full sm:w-auto" asChild>
          <Link href="/prompts/new?type=SKILL">
            <Plus className="h-3.5 w-3.5 mr-1" />
            {t("createSkill")}
          </Link>
        </Button>
      </div>
      
      <p className="text-sm text-muted-foreground mb-6">
        {t("skillsDescription")}
      </p>

      <InfinitePromptList
        initialPrompts={skills}
        initialTotal={total}
        filters={{
          q: params.q,
          type: "SKILL",
          sort: params.sort,
        }}
      />
    </div>
  );
}
