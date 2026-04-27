import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Bell, FolderOpen, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { promptsCol, categoriesCol, categorySubscriptionsCol } from "@/lib/mongodb";
import { formatPromptsForCard, docId } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PromptList } from "@/components/prompts/prompt-list";

export default async function FeedPage() {
  const t = await getTranslations("feed");
  const session = await auth();

  // Redirect to login if not authenticated
  if (!session?.user) {
    redirect("/login");
  }

  // Get user's subscribed categories
  const subscriptionDocs = await categorySubscriptionsCol()
    .find({ userId: session.user.id })
    .toArray();

  const subscribedCategoryIds = subscriptionDocs.map((s) => s.categoryId);

  // Resolve category details for subscribed categories
  const subscribedCategories =
    subscribedCategoryIds.length > 0
      ? await categoriesCol()
          .find({ _id: { $in: subscribedCategoryIds } } as Record<string, unknown>)
          .project({ _id: 1, name: 1, slug: 1 })
          .toArray()
      : [];

  const subscriptions = subscribedCategories.map((cat) => ({
    categoryId: docId(cat),
    category: {
      id: docId(cat),
      name: cat.name as string,
      slug: cat.slug as string,
    },
  }));

  // Fetch prompts from subscribed categories
  const promptDocs =
    subscribedCategoryIds.length > 0
      ? await promptsCol()
          .find({
            isPrivate: false,
            isUnlisted: false,
            deletedAt: null,
            categoryId: { $in: subscribedCategoryIds },
          })
          .sort({ createdAt: -1 })
          .limit(30)
          .toArray()
      : [];

  const prompts = await formatPromptsForCard(promptDocs);

  // Get all categories for subscription suggestions
  const allCategoryDocs = await categoriesCol()
    .find({})
    .sort({ name: 1 })
    .toArray();

  // Get prompt counts per category
  const countAgg = await promptsCol()
    .aggregate([
      { $match: { isPrivate: false, deletedAt: null } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } },
    ])
    .toArray();
  const countMap = new Map(countAgg.map((c) => [c._id as string, c.count as number]));

  const categories = allCategoryDocs.map((cat) => ({
    id: docId(cat),
    name: cat.name,
    slug: cat.slug,
    _count: { prompts: countMap.get(docId(cat)) ?? 0 },
  }));

  return (
    <div className="container py-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold">{t("yourFeed")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("feedDescription")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/prompts">
              {t("browseAll")}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/discover">
              <Sparkles className="mr-1.5 h-4 w-4" />
              {t("discover")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Subscribed Categories */}
      {subscriptions.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {subscriptions.map(({ category }) => (
            <Link key={category.id} href={`/categories/${category.slug}`}>
              <Badge variant="secondary" className="gap-1">
                <Bell className="h-3 w-3" />
                {category.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {/* Feed */}
      {prompts.length > 0 ? (
        <PromptList prompts={prompts} currentPage={1} totalPages={1} />
      ) : (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <FolderOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-medium mb-1">{t("noPromptsInFeed")}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {t("subscribeToCategories")}
          </p>

          {/* Category suggestions */}
          <div className="flex flex-wrap justify-center gap-2 max-w-md mx-auto">
            {categories.slice(0, 6).map((category) => (
              <Link key={category.id} href={`/categories/${category.slug}`}>
                <Badge variant="outline" className="cursor-pointer hover:bg-accent">
                  {category.name}
                  <span className="ml-1 text-muted-foreground">({category._count.prompts})</span>
                </Badge>
              </Link>
            ))}
          </div>

          <div className="mt-4">
            <Button variant="outline" size="sm" asChild>
              <Link href="/categories">{t("viewAllCategories")}</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
