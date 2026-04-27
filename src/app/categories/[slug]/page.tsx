import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { categoriesCol, promptsCol, categorySubscriptionsCol } from "@/lib/mongodb";
import { formatPromptsForCard, docId } from "@/lib/mongodb/prompt-helpers";
import config from "@/../prompts.config";
import { Button } from "@/components/ui/button";
import { PromptList } from "@/components/prompts/prompt-list";
import { SubscribeButton } from "@/components/categories/subscribe-button";
import { CategoryFilters } from "@/components/categories/category-filters";
import { McpServerPopup } from "@/components/mcp/mcp-server-popup";
import type { Filter } from "mongodb";
import type { PromptDocument } from "@/lib/mongodb";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string; sort?: string; q?: string }>;
}

const PROMPTS_PER_PAGE = 30;

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const category = await categoriesCol()
    .findOne(
      { slug },
      { projection: { name: 1, description: 1 } }
    );

  if (!category) {
    return { title: "Category Not Found" };
  }

  return {
    title: category.name,
    description: category.description || `Browse prompts in ${category.name}`,
  };
}

export default async function CategoryPage({ params, searchParams }: CategoryPageProps) {
  const { slug } = await params;
  const { page, sort, q } = await searchParams;
  const currentPage = Math.max(1, parseInt(page || "1", 10) || 1);
  const sortOption = sort || "newest";
  const session = await auth();
  const t = await getTranslations();

  const category = await categoriesCol().findOne({ slug });

  if (!category) {
    notFound();
  }

  const catId = docId(category);

  // Get subscriber count
  const subscriberCount = await categorySubscriptionsCol().countDocuments({ categoryId: catId });

  // Check if user is subscribed
  const isSubscribed = session?.user
    ? !!(await categorySubscriptionsCol().findOne({
        userId: session.user.id,
        categoryId: catId,
      }))
    : false;

  // Build where filter with optional search
  const baseFilter: Filter<PromptDocument> = {
    categoryId: catId,
    isPrivate: false,
    isUnlisted: false,
    deletedAt: null,
  };

  if (q) {
    (baseFilter as Record<string, unknown>).$and = [
      {
        $or: [
          { title: { $regex: q, $options: "i" } },
          { content: { $regex: q, $options: "i" } },
        ],
      },
    ];
  }

  // Build sort based on sort option
  const getSort = () => {
    switch (sortOption) {
      case "oldest":
        return { createdAt: 1 as const };
      case "most_upvoted":
        return { voteCount: -1 as const };
      case "most_contributors":
        // no contributorCount field in Mongo — fall back to voteCount
        return { voteCount: -1 as const };
      default:
        return { createdAt: -1 as const };
    }
  };

  // Count total prompts for pagination
  const totalPrompts = await promptsCol().countDocuments(baseFilter as Filter<PromptDocument>);
  const totalPages = Math.ceil(totalPrompts / PROMPTS_PER_PAGE);

  // Fetch prompts in this category
  const promptDocs = await promptsCol()
    .find(baseFilter as Filter<PromptDocument>)
    .sort(getSort())
    .skip((currentPage - 1) * PROMPTS_PER_PAGE)
    .limit(PROMPTS_PER_PAGE)
    .toArray();

  const prompts = await formatPromptsForCard(promptDocs);

  const categoryForComponent = {
    id: catId,
    name: category.name,
    description: category.description,
    _count: {
      subscribers: subscriberCount,
    },
  };

  return (
    <div className="container py-6">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" className="mb-4 -ml-2" asChild>
          <Link href="/categories">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("categories.allCategories")}
          </Link>
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold">{categoryForComponent.name}</h1>
              {session?.user && (
                <SubscribeButton
                  categoryId={categoryForComponent.id}
                  categoryName={categoryForComponent.name}
                  initialSubscribed={isSubscribed}
                  pill
                />
              )}
            </div>
            {categoryForComponent.description && (
              <p className="text-sm text-muted-foreground mt-1">
                {categoryForComponent.description}
              </p>
            )}
            <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
              <span>{t("categories.promptCount", { count: totalPrompts })}</span>
              <span>•</span>
              <span>{t("categories.subscriberCount", { count: categoryForComponent._count.subscribers })}</span>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <CategoryFilters categorySlug={slug} />
            {config.features.mcp !== false && <McpServerPopup initialCategories={[slug]} showOfficialBranding={!config.homepage?.useCloneBranding} />}
          </div>
        </div>

        {/* Mobile filters */}
        <div className="flex md:hidden items-center gap-2 mt-4">
          <CategoryFilters categorySlug={slug} />
          {config.features.mcp !== false && <McpServerPopup initialCategories={[slug]} showOfficialBranding={!config.homepage?.useCloneBranding} />}
        </div>
      </div>

      {/* Prompts */}
      <PromptList prompts={prompts} currentPage={currentPage} totalPages={totalPages} />
    </div>
  );
}
