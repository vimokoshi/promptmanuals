import { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDistanceToNow } from "@/lib/date";
import { Clock, Edit, History, GitPullRequest, Check, X, Users, ImageIcon, Video, FileText, Shield, Trash2, Cpu, Terminal, Wrench } from "lucide-react";
import { AnimatedDate } from "@/components/ui/animated-date";
import { ShareDropdown } from "@/components/prompts/share-dropdown";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, categoriesCol, collectionsCol, promptConnectionsCol, changeRequestsCol } from "@/lib/mongodb";
import { formatTags, docId } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InteractivePromptContent } from "@/components/prompts/interactive-prompt-content";
import { SkillViewer } from "@/components/prompts/skill-viewer";
import { UpvoteButton } from "@/components/prompts/upvote-button";
import { AddVersionForm } from "@/components/prompts/add-version-form";
import { DeleteVersionButton } from "@/components/prompts/delete-version-button";
import { VersionCompareModal } from "@/components/prompts/version-compare-modal";
import { VersionCompareButton } from "@/components/prompts/version-compare-button";
import { FeaturePromptButton } from "@/components/prompts/feature-prompt-button";
import { UnlistPromptButton } from "@/components/prompts/unlist-prompt-button";
import { UserExamplesSection } from "@/components/prompts/user-examples-section";
import { DelistBanner } from "@/components/prompts/delist-banner";
import { RestorePromptButton } from "@/components/prompts/restore-prompt-button";
import { CommentSection } from "@/components/comments";
import { PromptFlowSection } from "@/components/prompts/prompt-flow-section";
import { RelatedPrompts } from "@/components/prompts/related-prompts";
import { AddToCollectionButton } from "@/components/prompts/add-to-collection-button";
import { getConfig } from "@/lib/config";
import { StructuredData } from "@/components/seo/structured-data";
import { AI_MODELS } from "@/lib/works-best-with";
import { EzoicAd } from "@/components/ads/ezoic-ad";
import { TestPromptSidebar } from "@/components/prompts/test-prompt-sidebar";
import { PromptLanguageRow } from "@/components/prompts/prompt-language-row";

interface PromptPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Extracts the prompt ID from a URL parameter that may contain a slug
 * Supports formats: "abc123", "abc123_some-slug", or "abc123_some-slug.prompt.md"
 */
function extractPromptId(idParam: string): string {
  let param = idParam;
  // Strip .prompt.md suffix if present
  if (param.endsWith(".prompt.md")) {
    param = param.slice(0, -".prompt.md".length);
  }
  // If the param contains an underscore, extract the ID (everything before first underscore)
  const underscoreIndex = param.indexOf("_");
  if (underscoreIndex !== -1) {
    return param.substring(0, underscoreIndex);
  }
  return param;
}


const TRANSLATED_LANGS = ["es","zh","ja","de","fr","pt","ko","tr","ar","ru","hi","bn","ta","te","mr","gu"] as const;

/** Cached prompt metadata fetch — 1 hour TTL, keyed by prompt ID. */
const getPromptMetadata = unstable_cache(
  async (id: string) => {
    const doc = await promptsCol().findOne(
      { _id: id } as Record<string, unknown>,
      { projection: { title: 1, description: 1, slug: 1, content: 1, seoMeta: 1, translations: 1, categoryId: 1 } }
    );
    if (!doc) return null;

    let categoryName: string | null = null;
    if (doc.categoryId) {
      const cat = await categoriesCol().findOne(
        { _id: doc.categoryId } as Record<string, unknown>,
        { projection: { name: 1 } }
      );
      categoryName = cat?.name ?? null;
    }

    return {
      title: doc.title,
      description: doc.description ?? null,
      slug: doc.slug ?? null,
      content: doc.content,
      seoMeta: doc.seoMeta ?? null,
      translations: doc.translations ?? null,
      category: categoryName ? { name: categoryName } : null,
    };
  },
  ["prompt-metadata"],
  { revalidate: 3600, tags: ["prompts"] },
);

export async function generateMetadata({ params }: PromptPageProps): Promise<Metadata> {
  const { id: idParam } = await params;
  const id = extractPromptId(idParam);
  const prompt = await getPromptMetadata(id);

  if (!prompt) {
    return { title: "Prompt Not Found" };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
  const canonicalUrl = `${baseUrl}/prompts/${id}_${prompt.slug}`;
  const categoryName = prompt.category?.name || "AI";
  const seoTitle = `${prompt.title} — ${categoryName} AI Prompt | Prompt Manuals`;
  const seoMeta = prompt.seoMeta as { meta_description?: string } | null;
  const description = seoMeta?.meta_description || prompt.description || `${prompt.content.substring(0, 120)}...`;

  // Build hreflang alternates for all translated languages that have content
  const translations = prompt.translations as Record<string, { title?: string; content?: string }> | null;
  const langAlternates: Record<string, string> = { "x-default": canonicalUrl, en: canonicalUrl };
  if (translations) {
    for (const lang of TRANSLATED_LANGS) {
      if (translations[lang]?.title) {
        langAlternates[lang] = `${baseUrl}/prompts/${id}_${prompt.slug}/${lang}`;
      }
    }
  }

  return {
    title: seoTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: langAlternates,
    },
    openGraph: {
      title: seoTitle,
      description,
      url: canonicalUrl,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: seoTitle,
      description,
    },
  };
}

export default async function PromptPage({ params }: PromptPageProps) {
  const { id: idParam } = await params;
  const id = extractPromptId(idParam);
  const session = await auth();
  const config = await getConfig();
  const t = await getTranslations("prompts");
  const locale = await getLocale();

  const isAdmin = session?.user?.role === "ADMIN";

  // Admins can view deleted prompts, others cannot
  const promptDoc = await promptsCol().findOne(
    { _id: id, ...(isAdmin ? {} : { deletedAt: null }) } as Record<string, unknown>
  );

  if (!promptDoc) notFound();

  // Check if user can view private prompt
  if (promptDoc.isPrivate && promptDoc.authorId !== session?.user?.id) notFound();

  // Parallel fetches for all associated data
  const [
    authorDoc,
    categoryDoc,
    relatedConnections,
    flowConnectionCount,
    changeRequestDocs,
    userCollectionDoc,
  ] = await Promise.all([
    usersCol().findOne({ _id: promptDoc.authorId } as Record<string, unknown>),
    promptDoc.categoryId
      ? categoriesCol().findOne({ _id: promptDoc.categoryId } as Record<string, unknown>)
      : Promise.resolve(null),
    promptConnectionsCol()
      .find({ sourceId: id, label: "related" } as Record<string, unknown>)
      .sort({ order: 1 })
      .toArray(),
    promptConnectionsCol().countDocuments({
      $or: [
        { sourceId: id, label: { $ne: "related" } },
        { targetId: id, label: { $ne: "related" } },
      ],
    } as Record<string, unknown>),
    changeRequestsCol()
      .find({ promptId: id } as Record<string, unknown>)
      .sort({ createdAt: -1 })
      .toArray(),
    session?.user?.id
      ? collectionsCol().findOne({ userId: session.user.id, promptId: id } as Record<string, unknown>)
      : Promise.resolve(null),
  ]);

  // Fetch parent category
  const parentCategoryDoc = categoryDoc?.parentId
    ? await categoriesCol().findOne({ _id: categoryDoc.parentId } as Record<string, unknown>)
    : null;

  // Fetch version authors
  const versionAuthorIds = [...new Set(promptDoc.versions.map((v) => v.createdBy))];
  const versionAuthorDocs = versionAuthorIds.length > 0
    ? await usersCol().find({ _id: { $in: versionAuthorIds } } as Record<string, unknown>).toArray()
    : [];
  const versionAuthorMap = new Map(versionAuthorDocs.map((u) => [docId(u), u]));

  // Derive contributors: version authors who are not the prompt author
  const contributorIds = [...new Set(
    promptDoc.versions
      .map((v) => v.createdBy)
      .filter((uid) => uid !== promptDoc.authorId)
  )];
  const contributorDocs = contributorIds.length > 0
    ? await usersCol().find({ _id: { $in: contributorIds } } as Record<string, unknown>).toArray()
    : [];

  // Fetch related prompt targets
  const relatedTargetIds = relatedConnections.map((c) => c.targetId);
  const relatedPromptDocs = relatedTargetIds.length > 0
    ? await promptsCol()
        .find({ _id: { $in: relatedTargetIds }, isPrivate: false, isUnlisted: false, deletedAt: null } as Record<string, unknown>)
        .toArray()
    : [];

  // Fetch change request authors
  const crAuthorIds = [...new Set(changeRequestDocs.map((cr) => cr.authorId))];
  const crAuthorDocs = crAuthorIds.length > 0
    ? await usersCol().find({ _id: { $in: crAuthorIds } } as Record<string, unknown>).toArray()
    : [];
  const crAuthorMap = new Map(crAuthorDocs.map((u) => [docId(u), u]));

  // Fetch related prompt authors + categories
  const relatedAuthorIds = [...new Set(relatedPromptDocs.map((p) => p.authorId))];
  const relatedCategoryIds = [...new Set(relatedPromptDocs.map((p) => p.categoryId).filter(Boolean))] as string[];
  const [relatedAuthorDocs, relatedCategoryDocs] = await Promise.all([
    relatedAuthorIds.length > 0
      ? usersCol().find({ _id: { $in: relatedAuthorIds } } as Record<string, unknown>).toArray()
      : Promise.resolve([]),
    relatedCategoryIds.length > 0
      ? categoriesCol().find({ _id: { $in: relatedCategoryIds } } as Record<string, unknown>).toArray()
      : Promise.resolve([]),
  ]);
  const relatedAuthorMap = new Map(relatedAuthorDocs.map((u) => [docId(u), u]));
  const relatedCategoryMap = new Map(relatedCategoryDocs.map((c) => [docId(c), c]));

  // Assemble the unified prompt object
  const author = authorDoc!;
  const prompt = {
    ...promptDoc,
    id: docId(promptDoc),
    author: {
      id: docId(author),
      name: author.name ?? null,
      username: author.username,
      avatar: author.avatar ?? null,
      verified: author.verified ?? false,
    },
    category: categoryDoc
      ? {
          id: docId(categoryDoc),
          name: categoryDoc.name,
          slug: categoryDoc.slug,
          parent: parentCategoryDoc
            ? { id: docId(parentCategoryDoc), name: parentCategoryDoc.name, slug: parentCategoryDoc.slug }
            : null,
        }
      : null,
    tags: formatTags(promptDoc.tags),
    versions: promptDoc.versions.map((v) => {
      const vAuthor = versionAuthorMap.get(v.createdBy);
      return {
        id: v._id as unknown as string,
        version: v.version,
        content: v.content,
        changeNote: v.changeNote ?? null,
        createdAt: v.createdAt,
        author: {
          name: vAuthor?.name ?? null,
          username: vAuthor?.username ?? "unknown",
        },
      };
    }),
    _count: { votes: promptDoc.voteCount ?? 0 },
    contributors: contributorDocs.map((u) => ({
      id: docId(u),
      username: u.username,
      name: u.name ?? null,
      avatar: u.avatar ?? null,
    })),
  };

  const hasVoted = session?.user?.id
    ? promptDoc.votes.some((v) => v.userId === session.user!.id)
    : false;
  const inCollection = !!userCollectionDoc;
  const voteCount = promptDoc.voteCount ?? 0;
  const hasFlowConnections = flowConnectionCount > 0;

  // Assembled related prompts
  const relatedPrompts = relatedPromptDocs.map((rp) => {
    const rAuthor = relatedAuthorMap.get(rp.authorId);
    const rCategory = rp.categoryId ? relatedCategoryMap.get(rp.categoryId) : undefined;
    return {
      id: docId(rp),
      title: rp.title,
      slug: rp.slug ?? null,
      description: rp.description ?? null,
      type: rp.type,
      isPrivate: rp.isPrivate,
      isUnlisted: rp.isUnlisted,
      deletedAt: rp.deletedAt ?? null,
      author: rAuthor
        ? { id: docId(rAuthor), name: rAuthor.name ?? null, username: rAuthor.username, avatar: rAuthor.avatar ?? null }
        : { id: "", name: null, username: "unknown", avatar: null },
      category: rCategory
        ? { id: docId(rCategory), name: rCategory.name, slug: rCategory.slug }
        : null,
      _count: { votes: rp.voteCount ?? 0 },
    };
  });

  // Assembled change requests
  const changeRequests = changeRequestDocs.map((cr) => {
    const crAuthor = crAuthorMap.get(cr.authorId);
    return {
      id: docId(cr),
      status: cr.status,
      proposedTitle: cr.proposedTitle ?? null,
      originalTitle: cr.originalTitle ?? null,
      reason: cr.reason ?? null,
      createdAt: cr.createdAt,
      author: crAuthor
        ? { id: docId(crAuthor), name: crAuthor.name ?? null, username: crAuthor.username, avatar: crAuthor.avatar ?? null }
        : { id: "", name: null, username: "unknown", avatar: null },
    };
  });

  const isOwner = session?.user?.id === prompt.authorId;
  const canEdit = isOwner || isAdmin;
  const pendingCount = changeRequests.filter((cr) => cr.status === "PENDING").length;
  const tChanges = await getTranslations("changeRequests");

  const statusColors = {
    PENDING: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    APPROVED: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    REJECTED: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
  };

  const statusIcons = {
    PENDING: Clock,
    APPROVED: Check,
    REJECTED: X,
  };

  // Get delist reason
  const delistReason = (prompt as { delistReason?: string | null }).delistReason as
    | "TOO_SHORT" | "NOT_ENGLISH" | "LOW_QUALITY" | "NOT_LLM_INSTRUCTION" | "MANUAL" | null;

  // Get works best with fields
  const bestWithModels = (prompt as unknown as { bestWithModels?: string[] }).bestWithModels || [];
  const bestWithMCP = (prompt as unknown as { bestWithMCP?: { command: string; tools?: string[] }[] }).bestWithMCP || [];

  // seoMeta from WF04 pipeline
  const seoMetaData = prompt.seoMeta as {
    meta_description?: string;
    faq_pairs?: { question: string; answer: string }[];
    how_to_steps?: string[];
    voice_summary?: string;
  } | null;

  return (
    <>
      {/* Structured Data for Rich Results */}
      <StructuredData
        type="prompt"
        data={{
          prompt: {
            id: prompt.id,
            name: prompt.title,
            description: prompt.description || `AI prompt: ${prompt.title}`,
            content: prompt.content,
            author: prompt.author.name || prompt.author.username,
            authorUrl: `${process.env.NEXTAUTH_URL || "https://prompts.chat"}/@${prompt.author.username}`,
            datePublished: prompt.createdAt.toISOString(),
            dateModified: prompt.updatedAt.toISOString(),
            category: prompt.category?.name,
            tags: prompt.tags.map(({ tag }) => tag.name),
            voteCount: voteCount,
          },
        }}
      />
      <StructuredData
        type="breadcrumb"
        data={{
          breadcrumbs: [
            { name: "Home", url: "/" },
            { name: "Prompts", url: "/prompts" },
            ...(prompt.category ? [{ name: prompt.category.name, url: `/categories/${prompt.category.slug}` }] : []),
            { name: prompt.title, url: `/prompts/${prompt.id}` },
          ],
        }}
      />
      {/* FAQPage — WF04 seoMeta faq_pairs or fallback */}
      <StructuredData
        type="faq"
        data={{
          faq: seoMetaData?.faq_pairs?.length
            ? seoMetaData.faq_pairs
            : [
                {
                  question: `What is the ${prompt.title} prompt?`,
                  answer: prompt.description || `The ${prompt.title} prompt is an AI instruction you can use in ChatGPT, Claude, Gemini, and other AI tools to ${prompt.title.toLowerCase()}.`,
                },
                {
                  question: `How do I use the ${prompt.title} prompt?`,
                  answer: `Copy the prompt from Prompt Manuals, paste it into ChatGPT, Claude, Gemini, or your preferred AI tool, and press send. The AI will follow the instructions immediately.`,
                },
                {
                  question: `Which AI tools work with this ${prompt.category?.name || "AI"} prompt?`,
                  answer: `This prompt works with all major AI assistants including ChatGPT (GPT-4o), Claude (Anthropic), Google Gemini, Microsoft Copilot, and any other instruction-following language model.`,
                },
              ],
        }}
      />
      {/* Speakable — targets Google Assistant voice results */}
      <StructuredData
        type="speakable"
        data={{ speakable: { cssSelector: ["h1", ".prompt-description", ".prompt-content"] } }}
      />
      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8 items-start">
        <div>{/* main content */}
        {/* Deleted Banner - shown to admins when prompt is deleted */}
      {prompt.deletedAt && isAdmin && (
        <div className="mb-6 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
          <div className="flex items-start gap-3">
            <Trash2 className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="space-y-1 flex-1">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
                {t("promptDeleted")}
              </h3>
              <p className="text-sm text-red-600 dark:text-red-500">
                {t("promptDeletedDescription")}
              </p>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <RestorePromptButton promptId={prompt.id} />
          </div>
        </div>
      )}

      {/* Delist Banner - shown to owner and admins when prompt is delisted */}
      {prompt.isUnlisted && delistReason && (isOwner || isAdmin) && (
        <DelistBanner
          promptId={prompt.id}
          delistReason={delistReason}
          isOwner={isOwner}
          isDeleted={!!prompt.deletedAt}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        {/* Title row with upvote button */}
        <div className="flex items-center gap-4 mb-2">
          <div className="shrink-0">
            <UpvoteButton
              promptId={prompt.id}
              initialVoted={hasVoted}
              initialCount={voteCount}
              isLoggedIn={!!session?.user}
              size="circular"
            />
          </div>
          <div className="flex-1 flex items-center justify-between gap-4 min-w-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h1 className="text-3xl font-bold">{prompt.title}</h1>
              {prompt.isPrivate && (
                <Badge variant="secondary">{t("promptPrivate")}</Badge>
              )}
            </div>
          </div>
        </div>

        {/* Description */}
        {prompt.description && (
          <p className="text-muted-foreground">{prompt.description}</p>
        )}
      </div>
      <div className="border-b mb-6 sm:hidden" />

      {/* Meta info */}
      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            <Link href={`/@${prompt.author.username}`} title={`@${prompt.author.username}`}>
              <Avatar className="h-6 w-6 border-2 border-background">
                <AvatarImage src={prompt.author.avatar || undefined} />
                <AvatarFallback className="text-xs">{prompt.author.name?.charAt(0) || prompt.author.username.charAt(0)}</AvatarFallback>
              </Avatar>
            </Link>
            {prompt.contributors.map((contributor) => (
              <Link key={contributor.id} href={`/@${contributor.username}`} title={`@${contributor.username}`}>
                <Avatar className="h-6 w-6 border-2 border-background">
                  <AvatarImage src={contributor.avatar || undefined} />
                  <AvatarFallback className="text-xs">{contributor.name?.charAt(0) || contributor.username.charAt(0)}</AvatarFallback>
                </Avatar>
              </Link>
            ))}
          </div>
          {prompt.contributors.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-default">
                  <Link href={`/@${prompt.author.username}`} className="hover:underline">@{prompt.author.username}</Link> +{prompt.contributors.length}
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="p-2">
                <div className="space-y-1">
                  <div className="text-xs font-medium mb-1.5">{t("promptContributors")}</div>
                  {prompt.contributors.map((contributor) => (
                    <Link
                      key={contributor.id}
                      href={`/@${contributor.username}`}
                      className="flex items-center gap-2 hover:underline rounded px-1 py-0.5 -mx-1"
                    >
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={contributor.avatar || undefined} />
                        <AvatarFallback className="text-[8px]">
                          {contributor.name?.charAt(0) || contributor.username.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs">@{contributor.username}</span>
                    </Link>
                  ))}
                </div>
              </TooltipContent>
            </Tooltip>
          ) : (
            <Link href={`/@${prompt.author.username}`} className="hover:underline">@{prompt.author.username}</Link>
          )}
        </div>
        {prompt.contributors.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            <span>{prompt.contributors.length + 1} {t("contributors")}</span>
          </div>
        )}
        <AnimatedDate
          date={prompt.createdAt}
          relativeText={formatDistanceToNow(prompt.createdAt, locale)}
          locale={locale}
        />
      </div>

      {/* Category and Tags */}
      {(prompt.category || prompt.tags.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {prompt.category && (
            <Link href={`/categories/${prompt.category.slug}`}>
              <Badge variant="outline">{prompt.category.name}</Badge>
            </Link>
          )}
          {prompt.category && prompt.tags.length > 0 && (
            <span className="text-muted-foreground">•</span>
          )}
          {prompt.tags.map(({ tag }) => (
            <Link key={tag.id} href={`/tags/${tag.slug}`}>
              <Badge
                variant="secondary"
                style={{ backgroundColor: tag.color + "20", color: tag.color }}
              >
                {tag.name}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      {/* Content Tabs */}
      <Tabs defaultValue="content">
        <div className="flex flex-col gap-3 mb-4">
          {/* Action buttons - on top on mobile */}
          <div className="flex items-center justify-between gap-2 md:hidden">
            <AddToCollectionButton
              promptId={prompt.id}
              initialInCollection={inCollection}
              isLoggedIn={!!session?.user}
            />
            <div className="flex gap-2">
              {!isOwner && session?.user && (
                <Button asChild size="sm">
                  <Link href={`/prompts/${id}/changes/new`}>
                    <GitPullRequest className="h-4 w-4 mr-1.5" />
                    {t("createChangeRequest")}
                  </Link>
                </Button>
              )}
              {isOwner && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/prompts/${id}/edit`}>
                    <Edit className="h-4 w-4 mr-1.5" />
                    {t("edit")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="content">{t("promptContent")}</TabsTrigger>
              <TabsTrigger value="versions" className="gap-1">
                <History className="h-4 w-4" />
                {t("versions")}
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                  {prompt.versions.length > 0 ? prompt.versions[0].version : 1}
                </Badge>
              </TabsTrigger>
              {changeRequests.length > 0 && (
                <TabsTrigger value="changes" className="gap-1">
                  <GitPullRequest className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("changeRequests")}</span>
                  {pendingCount > 0 && (
                    <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1 text-xs">
                      {pendingCount}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
            </TabsList>
            {/* Action buttons - inline on desktop */}
            <div className="hidden md:flex items-center gap-2">
              <AddToCollectionButton
                promptId={prompt.id}
                initialInCollection={inCollection}
                isLoggedIn={!!session?.user}
              />
              {!isOwner && session?.user && (
                <Button asChild size="sm">
                  <Link href={`/prompts/${id}/changes/new`}>
                    <GitPullRequest className="h-4 w-4 mr-1.5" />
                    {t("createChangeRequest")}
                  </Link>
                </Button>
              )}
              {isOwner && (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/prompts/${id}/edit`}>
                    <Edit className="h-4 w-4 mr-1.5" />
                    {t("edit")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>

        <TabsContent value="content" className="space-y-4 mt-0">
          {/* Media Preview with User Examples (for image/video prompts) */}
          {prompt.mediaUrl && (
            <UserExamplesSection
              mediaUrl={prompt.mediaUrl}
              title={prompt.title}
              type={prompt.type}
              promptId={prompt.id}
              isLoggedIn={!!session?.user}
              currentUserId={session?.user?.id}
              isAdmin={isAdmin}
            />
          )}

          {/* Prompt Text Content */}
          <div>
            {prompt.requiresMediaUpload && prompt.requiredMediaType && prompt.requiredMediaCount && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 mb-3">
                {prompt.requiredMediaType === "IMAGE" && <ImageIcon className="h-3.5 w-3.5" />}
                {prompt.requiredMediaType === "VIDEO" && <Video className="h-3.5 w-3.5" />}
                {prompt.requiredMediaType === "DOCUMENT" && <FileText className="h-3.5 w-3.5" />}
                <span className="text-xs font-medium">
                  {prompt.requiredMediaType === "IMAGE"
                    ? t("requiresImage", { count: prompt.requiredMediaCount })
                    : prompt.requiredMediaType === "VIDEO"
                    ? t("requiresVideo", { count: prompt.requiredMediaCount })
                    : t("requiresDocument", { count: prompt.requiredMediaCount })}
                </span>
              </div>
            )}
            {prompt.type === "SKILL" ? (
              <SkillViewer
                content={prompt.content}
                promptId={prompt.id}
                promptSlug={prompt.slug ?? undefined}
              />
            ) : prompt.type === "TASTE" ? (
              <InteractivePromptContent
                content={prompt.content}
                title="taste.md"
                isLoggedIn={!!session?.user}
                promptId={prompt.id}
                promptSlug={prompt.slug ?? undefined}
                promptType={prompt.type}
                shareTitle={prompt.title}
                promptTitle={prompt.title}
                promptDescription={prompt.description ?? undefined}
                hidePlatformLauncher
              />
            ) : prompt.structuredFormat ? (
              <InteractivePromptContent
                content={prompt.content}
                isStructured={true}
                structuredFormat={(prompt.structuredFormat?.toLowerCase() as "json" | "yaml") || "json"}
                title={t("promptContent")}
                isLoggedIn={!!session?.user}
                categoryName={prompt.category?.name}
                parentCategoryName={prompt.category?.parent?.name}
                promptId={prompt.id}
                promptSlug={prompt.slug ?? undefined}
                promptType={prompt.type}
                shareTitle={prompt.title}
                promptTitle={prompt.title}
                promptDescription={prompt.description ?? undefined}
                hidePlatformLauncher
              />
            ) : (
              <InteractivePromptContent
                content={prompt.content}
                title={t("promptContent")}
                isLoggedIn={!!session?.user}
                categoryName={prompt.category?.name}
                parentCategoryName={prompt.category?.parent?.name}
                promptId={prompt.id}
                promptSlug={prompt.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}
                promptType={prompt.type}
                shareTitle={prompt.title}
                promptTitle={prompt.title}
                promptDescription={prompt.description ?? undefined}
                hidePlatformLauncher
              />
            )}
          </div>

          {/* Works Best With */}
          {bestWithModels.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Cpu className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("worksBestWith")}:</span>
              <div className="flex flex-wrap gap-1.5">
                {bestWithModels.map((slug) => {
                  const model = AI_MODELS[slug as keyof typeof AI_MODELS];
                  return (
                    <Badge key={slug} variant="secondary" className="text-xs">
                      {model?.name || slug}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {/* MCP Tools */}
          {bestWithMCP.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t("mcpTools")}:</span>
              <div className="flex flex-wrap gap-1.5">
                {bestWithMCP.flatMap((mcp, mcpIndex) =>
                  mcp.tools && mcp.tools.length > 0
                    ? mcp.tools.map((tool, toolIndex) => (
                        <Tooltip key={`${mcpIndex}-${toolIndex}`}>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs font-mono cursor-help gap-1">
                              <Wrench className="h-3 w-3" />
                              {tool}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <code className="text-xs break-all">{mcp.command}</code>
                          </TooltipContent>
                        </Tooltip>
                      ))
                    : [(
                        <Tooltip key={mcpIndex}>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs font-mono cursor-help">
                              {mcp.command.split("/").pop()?.replace("server-", "") || mcp.command}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <code className="text-xs break-all">{mcp.command}</code>
                          </TooltipContent>
                        </Tooltip>
                      )]
                )}
              </div>
            </div>
          )}

          {/* Language row — links to translated URL pages */}
          <PromptLanguageRow
            currentLocale={locale}
            promptId={prompt.id}
            promptSlug={prompt.slug ?? ""}
            translations={prompt.translations as Record<string, { title?: string }> | null}
          />

          {/* FAQ Section — from WF04 seoMeta */}
          {seoMetaData?.faq_pairs && seoMetaData.faq_pairs.length > 0 && (
            <div className="mt-6 pt-6 border-t space-y-4">
              <h2 className="text-base font-semibold">Frequently Asked Questions</h2>
              <dl className="space-y-4">
                {seoMetaData.faq_pairs.map((pair, i) => (
                  <div key={i} className="space-y-1">
                    <dt className="text-sm font-medium">{pair.question}</dt>
                    <dd className="text-sm text-muted-foreground">{pair.answer}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Report & Prompt Flow - hide for SKILL and TASTE types */}
          {prompt.type !== "SKILL" && prompt.type !== "TASTE" && (
            <PromptFlowSection
              promptId={prompt.id}
              promptTitle={prompt.title}
              canEdit={canEdit}
              isOwner={isOwner}
              isLoggedIn={!!session?.user}
              currentUserId={session?.user?.id}
              isAdmin={isAdmin}
              workflowLink={(prompt as unknown as { workflowLink?: string | null }).workflowLink}
              hasFlowConnections={hasFlowConnections}
            />
          )}

          {/* Related Prompts */}
          {relatedPrompts.length > 0 && (
            <RelatedPrompts prompts={relatedPrompts} />
          )}

          {/* Comments Section */}
          {config.features.comments !== false && !prompt.isPrivate && (
            <CommentSection
              promptId={prompt.id}
              currentUserId={session?.user?.id}
              isAdmin={isAdmin}
              isLoggedIn={!!session?.user}
              locale={locale}
            />
          )}

          {/* Ad Placement */}
          {process.env.NEXT_PUBLIC_EZOIC_ENABLED === "true" && <EzoicAd id={201} />}
        </TabsContent>

        <TabsContent value="versions" className="mt-0">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold">{t("versionHistory")}</h3>
              <div className="flex items-center gap-2">
                <VersionCompareModal
                  versions={prompt.versions}
                  currentContent={prompt.content}
                  promptType={prompt.type}
                  structuredFormat={prompt.structuredFormat}
                />
                {canEdit && (
                  <AddVersionForm promptId={prompt.id} currentContent={prompt.content} />
                )}
              </div>
            </div>
            {prompt.versions.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center">{t("noVersions")}</p>
            ) : (
              <div className="divide-y border rounded-lg">
                {prompt.versions.map((version, index) => {
                  const isLatestVersion = index === 0;
                  return (
                    <div
                      key={version.id}
                      className="px-4 py-3 flex items-start gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">v{version.version}</span>
                          {isLatestVersion && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                              {t("currentVersion")}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(version.createdAt, locale)}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            by @{version.author.username}
                          </span>
                        </div>
                        {version.changeNote && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {version.changeNote}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {!isLatestVersion && (
                          <VersionCompareButton
                            versionContent={version.content}
                            versionNumber={version.version}
                            currentContent={prompt.content}
                            promptType={prompt.type}
                            structuredFormat={prompt.structuredFormat}
                          />
                        )}
                        {canEdit && !isLatestVersion && (
                          <DeleteVersionButton
                            promptId={prompt.id}
                            versionId={version.id}
                            versionNumber={version.version}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>

        {changeRequests.length > 0 && (
          <TabsContent value="changes" className="mt-0">
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-semibold">{t("changeRequests")}</h3>
              </div>
              <div className="divide-y border rounded-lg">
                {changeRequests.map((cr) => {
                  const StatusIcon = statusIcons[cr.status];
                  const hasTitleChange = cr.proposedTitle && cr.proposedTitle !== cr.originalTitle;
                  return (
                    <Link
                      key={cr.id}
                      href={`/prompts/${id}/changes/${cr.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-accent/50 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    >
                      <div className={`p-1.5 rounded-full shrink-0 ${
                        cr.status === "PENDING"
                          ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400"
                          : cr.status === "APPROVED"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-red-500/10 text-red-600 dark:text-red-400"
                      }`}>
                        <StatusIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {hasTitleChange ? (
                              <>
                                <span className="line-through text-muted-foreground">{cr.originalTitle}</span>
                                {" → "}
                                <span>{cr.proposedTitle}</span>
                              </>
                            ) : (
                              tChanges("contentChanges")
                            )}
                          </span>
                        </div>
                        {cr.reason && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {cr.reason}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Avatar className="h-5 w-5">
                            <AvatarImage src={cr.author.avatar || undefined} />
                            <AvatarFallback className="text-[9px]">
                              {cr.author.name?.[0] || cr.author.username[0]}
                            </AvatarFallback>
                          </Avatar>
                          <span className="hidden sm:inline">@{cr.author.username}</span>
                        </div>
                        <span className="text-xs text-muted-foreground hidden sm:inline">
                          {formatDistanceToNow(cr.createdAt, locale)}
                        </span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-5 ${statusColors[cr.status]}`}>
                          {tChanges(cr.status.toLowerCase())}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          </TabsContent>
        )}
      </Tabs>

      {/* Admin Area */}
      {isAdmin && (
        <div className="mt-8 p-4 rounded-lg border border-red-500/30 bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-500">{t("adminArea")}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <FeaturePromptButton
              promptId={prompt.id}
              isFeatured={prompt.isFeatured}
            />
            <UnlistPromptButton
              promptId={prompt.id}
              isUnlisted={prompt.isUnlisted}
            />
            <Button variant="outline" size="sm" asChild>
              <Link href={`/prompts/${id}/edit`}>
                <Edit className="h-4 w-4 mr-2" />
                {t("edit")}
              </Link>
            </Button>
          </div>
        </div>
      )}

        </div>{/* end main content */}

        {/* Sidebar */}
        <TestPromptSidebar content={prompt.content} />

        </div>{/* end grid */}
      </div>
    </>
  );
}
