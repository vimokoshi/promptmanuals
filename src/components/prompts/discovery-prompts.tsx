import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Clock, Flame, RefreshCw, Star, Users } from "lucide-react";
import { promptsCol } from "@/lib/mongodb";
import { formatPromptsForCard } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { Masonry } from "@/components/ui/masonry";
import { PromptCard } from "@/components/prompts/prompt-card";
import { EzoicAd } from "@/components/ads/ezoic-ad";

interface DiscoveryPromptsProps {
  isHomepage?: boolean;
}

export async function DiscoveryPrompts({ isHomepage = false }: DiscoveryPromptsProps) {
  const t = await getTranslations("feed");
  const tDiscovery = await getTranslations("discovery");

  const limit = isHomepage ? 9 : 15;

  // Get today's date at midnight for filtering today's votes
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const baseMatch = { isPrivate: false, isUnlisted: false, deletedAt: null };

  const [
    featuredDocs,
    todaysMostUpvotedDocs,
    latestDocs,
    recentlyUpdatedDocs,
    mostContributedDocs,
  ] = await Promise.all([
    // Featured prompts
    promptsCol()
      .find({ ...baseMatch, isFeatured: true })
      .sort({ featuredAt: -1 })
      .limit(limit)
      .toArray(),
    // Today's most upvoted — prompts with at least one vote today, sorted by voteCount
    promptsCol()
      .find({
        ...baseMatch,
        "votes.createdAt": { $gte: today },
      })
      .sort({ voteCount: -1 })
      .limit(limit)
      .toArray(),
    // Latest prompts
    promptsCol()
      .find(baseMatch)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray(),
    // Recently updated
    promptsCol()
      .find(baseMatch)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .toArray(),
    // Most contributed — most versions by non-authors (approximate via version count)
    promptsCol()
      .find(baseMatch)
      .sort({ "versions": -1 })
      .limit(limit)
      .toArray(),
  ]);

  const [
    featuredPrompts,
    todaysMostUpvoted,
    latestPrompts,
    recentlyUpdated,
    mostContributed,
  ] = await Promise.all([
    formatPromptsForCard(featuredDocs),
    formatPromptsForCard(todaysMostUpvotedDocs),
    formatPromptsForCard(latestDocs),
    formatPromptsForCard(recentlyUpdatedDocs),
    formatPromptsForCard(mostContributedDocs),
  ]);

  return (
    <div className={isHomepage ? "flex flex-col" : "container py-6"}>
      {/* Featured Prompts Section */}
      {featuredPrompts.length > 0 && (
        <section className={isHomepage ? "py-12 border-b" : "pb-8 mb-8 border-b"}>
          <div className={isHomepage ? "container" : ""}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Star className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                <h2 className="text-xl font-semibold">{tDiscovery("featuredPrompts")}</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prompts" prefetch={false}>
                  {t("browseAll")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {featuredPrompts.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          </div>
        </section>
      )}

      {/* Ad Placement - after featured */}
      {isHomepage && process.env.NEXT_PUBLIC_EZOIC_ENABLED === "true" && (
        <section className="py-8 border-b">
          <div className="container max-w-2xl">
            <EzoicAd id={202} />
          </div>
        </section>
      )}

      {/* Today's Most Upvoted Section */}
      {todaysMostUpvoted.length > 0 && (
        <section className={isHomepage ? "py-12 border-b" : "pb-8 mb-8 border-b"}>
          <div className={isHomepage ? "container" : ""}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Flame className="h-5 w-5 text-orange-500" />
                <h2 className="text-xl font-semibold">{tDiscovery("todaysMostUpvoted")}</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prompts" prefetch={false}>
                  {t("browseAll")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {todaysMostUpvoted.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          </div>
        </section>
      )}

      {/* Latest Prompts Section */}
      {latestPrompts.length > 0 && (
        <section className={isHomepage ? "py-12 border-b" : "pb-8 mb-8 border-b"}>
          <div className={isHomepage ? "container" : ""}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <h2 className="text-xl font-semibold">{tDiscovery("latestPrompts")}</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prompts" prefetch={false}>
                  {t("browseAll")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {latestPrompts.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          </div>
        </section>
      )}

      {/* Ad Placement - after latest */}
      {isHomepage && process.env.NEXT_PUBLIC_EZOIC_ENABLED === "true" && (
        <section className="py-8 border-b">
          <div className="container max-w-2xl">
            <EzoicAd id={203} />
          </div>
        </section>
      )}

      {/* Recently Updated Section */}
      {recentlyUpdated.length > 0 && (
        <section className={isHomepage ? "py-12 border-b" : "pb-8 mb-8 border-b"}>
          <div className={isHomepage ? "container" : ""}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-blue-500" />
                <h2 className="text-xl font-semibold">{tDiscovery("recentlyUpdated")}</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prompts" prefetch={false}>
                  {t("browseAll")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {recentlyUpdated.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          </div>
        </section>
      )}

      {/* Most Contributed Section */}
      {mostContributed.length > 0 && (
        <section className={isHomepage ? "py-12 border-b" : "pb-8"}>
          <div className={isHomepage ? "container" : ""}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-green-500" />
                <h2 className="text-xl font-semibold">{tDiscovery("mostContributed")}</h2>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/prompts" prefetch={false}>
                  {t("browseAll")}
                  <ArrowRight className="ml-1.5 h-4 w-4" />
                </Link>
              </Button>
            </div>
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {mostContributed.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          </div>
        </section>
      )}
    </div>
  );
}
