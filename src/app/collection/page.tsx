import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Bookmark, Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";
import { collectionsCol, promptsCol } from "@/lib/mongodb";
import { formatPromptsForCard, docId } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { PromptList } from "@/components/prompts/prompt-list";

export default async function CollectionPage() {
  const t = await getTranslations("collection");
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  // Fetch saved collection entries for the user (each row = one saved promptId)
  const collectionDocs = await collectionsCol()
    .find({ userId: session.user.id })
    .sort({ createdAt: -1 })
    .toArray();

  // Resolve prompt documents in saved order
  const promptIds = collectionDocs.map((c) => c.promptId);
  const promptDocs =
    promptIds.length > 0
      ? await promptsCol()
          .find({
            _id: { $in: promptIds } as Record<string, unknown>,
            deletedAt: null,
          })
          .toArray()
      : [];

  // Preserve saved order and filter out missing/deleted prompts
  const promptIdSet = new Set(promptDocs.map((p) => docId(p)));
  const orderedDocs = promptIds
    .filter((id) => promptIdSet.has(id))
    .map((id) => promptDocs.find((p) => docId(p) === id)!);

  const prompts = await formatPromptsForCard(orderedDocs);

  return (
    <div className="container py-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-lg font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/prompts">
              {t("browsePrompts")}
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

      {prompts.length > 0 ? (
        <PromptList prompts={prompts} currentPage={1} totalPages={1} />
      ) : (
        <div className="text-center py-12 border rounded-lg bg-muted/30">
          <Bookmark className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h2 className="font-medium mb-1">{t("emptyTitle")}</h2>
          <p className="text-sm text-muted-foreground mb-4">
            {t("emptyDescription")}
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/prompts">{t("browsePrompts")}</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
