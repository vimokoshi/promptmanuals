import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Tag } from "lucide-react";
import { tagsCol, promptsCol } from "@/lib/mongodb";
import { formatPromptsForCard } from "@/lib/mongodb/prompt-helpers";
import { auth } from "@/lib/auth";
import config from "@/../prompts.config";
import { Button } from "@/components/ui/button";
import { PromptCard } from "@/components/prompts/prompt-card";
import { McpServerPopup } from "@/components/mcp/mcp-server-popup";

interface TagPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string }>;
}

export async function generateMetadata({ params }: TagPageProps) {
  const { slug } = await params;
  const tag = await tagsCol().findOne({ slug });

  if (!tag) return { title: "Tag Not Found" };

  return {
    title: `${tag.name} - Tags`,
    description: `Browse prompts tagged with ${tag.name}`,
  };
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
  const { slug } = await params;
  const { page: pageParam } = await searchParams;
  const session = await auth();
  const t = await getTranslations("tags");
  const tPrompts = await getTranslations("prompts");

  const tag = await tagsCol().findOne({ slug });

  if (!tag) {
    notFound();
  }

  const page = Math.max(1, parseInt(pageParam || "1") || 1);
  const perPage = 24;

  // Build match query — prompts with embedded tag matching slug
  const baseMatch = {
    "tags.slug": slug,
    isUnlisted: false,
    deletedAt: null,
    ...(session?.user
      ? { $or: [{ isPrivate: false }, { authorId: session.user.id }] }
      : { isPrivate: false }),
  };

  const [docs, total] = await Promise.all([
    promptsCol()
      .find(baseMatch)
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .toArray(),
    promptsCol().countDocuments(baseMatch),
  ]);

  const prompts = await formatPromptsForCard(docs);
  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="container py-6">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href="/tags">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            {t("allTags")}
          </Link>
        </Button>

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            <h1 className="text-xl font-semibold">{tag.name}</h1>
            <span className="text-sm text-muted-foreground">
              {total} {t("prompts")}
            </span>
          </div>
          {config.features.mcp !== false && <McpServerPopup initialTags={[slug]} showOfficialBranding={!config.homepage?.useCloneBranding} />}
        </div>
      </div>

      {/* Prompts Grid */}
      {prompts.length === 0 ? (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {tPrompts("noPrompts")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="columns-1 md:columns-2 lg:columns-3 gap-4">
            {prompts.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page <= 1}
                asChild={page > 1}
              >
                {page > 1 ? (
                  <Link href={`/tags/${slug}?page=${page - 1}`}>
                    {tPrompts("previous")}
                  </Link>
                ) : (
                  <span>{tPrompts("previous")}</span>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                {page} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page >= totalPages}
                asChild={page < totalPages}
              >
                {page < totalPages ? (
                  <Link href={`/tags/${slug}?page=${page + 1}`}>
                    {tPrompts("next")}
                  </Link>
                ) : (
                  <span>{tPrompts("next")}</span>
                )}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
