import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDistanceToNow } from "@/lib/date";
import { getPromptUrl } from "@/lib/urls";
import { Calendar, ArrowBigUp, FileText, Settings, GitPullRequest, Clock, Check, X, Pin, BadgeCheck, Users, ShieldCheck, Heart, ImageIcon } from "lucide-react";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, pinnedPromptsCol, changeRequestsCol, commentsCol } from "@/lib/mongodb";
import { formatPromptsForCard, docId, type PromptForCard } from "@/lib/mongodb/prompt-helpers";
import config from "@/../prompts.config";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromptList } from "@/components/prompts/prompt-list";
import { PromptCard, type PromptCardProps } from "@/components/prompts/prompt-card";
import { Masonry } from "@/components/ui/masonry";
import { McpServerPopup } from "@/components/mcp/mcp-server-popup";
import { PrivatePromptsNote } from "@/components/prompts/private-prompts-note";
import { ActivityChartWrapper } from "@/components/user/activity-chart-wrapper";
import { ProfileLinks, type CustomLink } from "@/components/user/profile-links";

interface UserProfilePageProps {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ page?: string; tab?: string; date?: string }>;
}

export async function generateMetadata({ params }: UserProfilePageProps): Promise<Metadata> {
  const { username: rawUsername } = await params;
  const decodedUsername = decodeURIComponent(rawUsername);

  // Only support /@username format
  if (!decodedUsername.startsWith("@")) {
    return { title: "User Not Found" };
  }

  const username = decodedUsername.slice(1);

  const user = await usersCol().findOne(
    { username: { $regex: new RegExp(`^${username}$`, "i") } },
    { projection: { name: 1, username: 1 } }
  );

  if (!user) {
    return { title: "User Not Found" };
  }

  return {
    title: `${user.name || user.username} (@${user.username})`,
    description: `View ${user.name || user.username}'s prompts`,
  };
}

export default async function UserProfilePage({ params, searchParams }: UserProfilePageProps) {
  const { username: rawUsername } = await params;
  const { page: pageParam, tab, date: dateFilter } = await searchParams;
  const session = await auth();
  const t = await getTranslations("user");
  const tChanges = await getTranslations("changeRequests");
  const tPrompts = await getTranslations("prompts");
  const locale = await getLocale();

  // Decode URL-encoded @ symbol
  const decodedUsername = decodeURIComponent(rawUsername);

  // Only support /@username format - reject URLs without @
  if (!decodedUsername.startsWith("@")) {
    notFound();
  }

  const username = decodedUsername.slice(1);

  const userDoc = await usersCol().findOne({
    username: { $regex: new RegExp(`^${username}$`, "i") },
  });

  if (!userDoc) {
    notFound();
  }

  const userId = docId(userDoc);
  const page = Math.max(1, parseInt(pageParam || "1") || 1);
  const perPage = 24;
  const isOwner = session?.user?.id === userId;
  const isUnclaimed = userDoc.email?.endsWith("@unclaimed.prompts.chat") ?? false;

  // Parse date filter for filtering prompts by day (validate YYYY-MM-DD format)
  const isValidDateFilter = dateFilter && /^\d{4}-\d{2}-\d{2}$/.test(dateFilter);
  const filterDateStart = isValidDateFilter ? new Date(dateFilter + "T00:00:00") : null;
  const filterDateEnd = isValidDateFilter ? new Date(dateFilter + "T23:59:59") : null;
  const validFilterDateStart = filterDateStart && !isNaN(filterDateStart.getTime()) ? filterDateStart : null;
  const validFilterDateEnd = filterDateEnd && !isNaN(filterDateEnd.getTime()) ? filterDateEnd : null;

  // Build match for main prompts query
  const promptsMatch: Record<string, unknown> = {
    authorId: userId,
    deletedAt: null,
    ...(isOwner ? {} : { isPrivate: false }),
    ...(validFilterDateStart && validFilterDateEnd
      ? { createdAt: { $gte: validFilterDateStart, $lte: validFilterDateEnd } }
      : {}),
  };

  // Activity range: last 12 months
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  oneYearAgo.setHours(0, 0, 0, 0);

  // Fetch all data in parallel
  const [
    promptDocs,
    total,
    pinnedPromptDocs,
    contributionDocs,
    likedDocs,
    userExampleDocs,
    privatePromptsCount,
    activityPrompts,
    activityVotes,
    activityChangeRequests,
    activityComments,
    submittedChangeRequests,
    receivedChangeRequests,
    totalUpvotesResult,
    promptCountAll,
    contributionCount,
  ] = await Promise.all([
    // Main prompts (paginated)
    promptsCol()
      .find(promptsMatch)
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .toArray(),

    // Total count for pagination
    promptsCol().countDocuments(promptsMatch),

    // Pinned prompts
    pinnedPromptsCol()
      .find({ userId })
      .sort({ order: 1 })
      .toArray(),

    // Contributions: prompts where user has a version but is not the author
    promptsCol()
      .find({
        "versions.createdBy": userId,
        authorId: { $ne: userId },
        isPrivate: false,
        deletedAt: null,
      })
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray(),

    // Liked prompts: prompts with embedded vote from this user
    promptsCol()
      .find({
        "votes.userId": userId,
        isPrivate: false,
        deletedAt: null,
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),

    // User examples: prompts where user submitted an example
    promptsCol()
      .find({
        "userExamples.userId": userId,
        isPrivate: false,
        deletedAt: null,
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray(),

    // Private prompts count (only relevant for owner)
    isOwner
      ? promptsCol().countDocuments({ authorId: userId, isPrivate: true, deletedAt: null })
      : Promise.resolve(0),

    // Activity: prompts created in last year
    promptsCol()
      .find({ authorId: userId, createdAt: { $gte: oneYearAgo } })
      .project({ createdAt: 1 })
      .toArray(),

    // Activity: votes cast in last year (embedded votes where userId matches)
    // We aggregate to find all vote timestamps for this user across all prompts
    promptsCol()
      .aggregate([
        { $match: { "votes.userId": userId } },
        { $unwind: "$votes" },
        { $match: { "votes.userId": userId, "votes.createdAt": { $gte: oneYearAgo } } },
        { $project: { createdAt: "$votes.createdAt" } },
      ])
      .toArray(),

    // Activity: change requests authored in last year
    changeRequestsCol()
      .find({ authorId: userId, createdAt: { $gte: oneYearAgo } })
      .project({ createdAt: 1 })
      .toArray(),

    // Activity: comments authored in last year
    commentsCol()
      .find({ authorId: userId, createdAt: { $gte: oneYearAgo } })
      .project({ createdAt: 1 })
      .toArray(),

    // Change requests submitted by user
    changeRequestsCol()
      .find({
        authorId: userId,
        ...(isOwner ? {} : { status: "APPROVED" }),
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray(),

    // Change requests received on user's prompts
    changeRequestsCol()
      .aggregate([
        {
          $lookup: {
            from: "prompts",
            localField: "promptId",
            foreignField: "_id",
            as: "promptDoc",
            pipeline: [{ $project: { authorId: 1 } }],
          },
        },
        { $unwind: "$promptDoc" },
        {
          $match: {
            "promptDoc.authorId": userId,
            authorId: { $ne: userId },
            ...(isOwner ? {} : { status: "APPROVED" }),
          },
        },
        { $sort: { createdAt: -1 } },
        { $limit: 100 },
      ])
      .toArray(),

    // Total upvotes received (sum of voteCount across all user's prompts)
    promptsCol()
      .aggregate([
        { $match: { authorId: userId, deletedAt: null } },
        { $group: { _id: null, total: { $sum: "$voteCount" } } },
      ])
      .toArray()
      .then((r) => (r[0]?.total as number) ?? 0),

    // Total prompt count (for profile stats — all non-deleted prompts)
    promptsCol().countDocuments({ authorId: userId, deletedAt: null }),

    // Contribution count (approved change requests authored by user)
    changeRequestsCol().countDocuments({ authorId: userId, status: "APPROVED" }),
  ]);

  // Format prompts for cards
  const [prompts, contributions, likedPrompts, userExamplesFormatted] = await Promise.all([
    formatPromptsForCard(promptDocs),
    formatPromptsForCard(contributionDocs),
    formatPromptsForCard(likedDocs),
    formatPromptsForCard(userExampleDocs),
  ]);

  // Override userExample mediaUrl with user's specific example
  const userExamples = userExamples_override(userExampleDocs, userExamplesFormatted, userId);

  // Fetch pinned prompt docs
  const pinnedPromptIds = pinnedPromptDocs.map((pp) => pp.promptId);
  const pinnedPromptRawDocs = pinnedPromptIds.length > 0
    ? await promptsCol()
        .find({
          _id: { $in: pinnedPromptIds } as Record<string, unknown>,
          ...(isOwner ? {} : { isPrivate: false }),
          deletedAt: null,
        })
        .toArray()
    : [];

  const pinnedPromptFormatted = await formatPromptsForCard(pinnedPromptRawDocs);

  // Sort pinned prompts by order
  const pinnedIdToOrder = new Map(pinnedPromptDocs.map((pp) => [pp.promptId, pp.order]));
  const pinnedPrompts = pinnedPromptFormatted.sort(
    (a, b) => (pinnedIdToOrder.get(a.id) ?? 0) - (pinnedIdToOrder.get(b.id) ?? 0)
  );
  const pinnedIds = new Set<string>(pinnedPrompts.map((p) => p.id));

  // Process activity data into daily counts
  const activityMap = new Map<string, number>();
  const allActivities = [
    ...activityPrompts,
    ...activityVotes,
    ...activityChangeRequests,
    ...activityComments,
  ];

  allActivities.forEach((item) => {
    const dateStr = (item.createdAt as Date).toISOString().split("T")[0];
    activityMap.set(dateStr, (activityMap.get(dateStr) || 0) + 1);
  });

  const activityData = Array.from(activityMap.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  // Fetch prompt details for change requests
  const crPromptIds = [
    ...new Set([
      ...submittedChangeRequests.map((cr) => cr.promptId),
      ...receivedChangeRequests.map((cr) => cr.promptId),
    ]),
  ];
  const crPromptDocs = crPromptIds.length > 0
    ? await promptsCol()
        .find({ _id: { $in: crPromptIds } } as Record<string, unknown>)
        .project({ _id: 1, slug: 1, title: 1, authorId: 1 })
        .toArray()
    : [];
  const crPromptMap = new Map(crPromptDocs.map((p) => [docId(p as { _id: unknown }), p]));

  // Fetch authors for change requests
  const crAuthorIds = [
    ...new Set([
      ...submittedChangeRequests.map((cr) => cr.authorId),
      ...receivedChangeRequests.map((cr) => cr.authorId),
    ]),
  ];
  const crAuthorDocs = crAuthorIds.length > 0
    ? await usersCol()
        .find({ _id: { $in: crAuthorIds } } as Record<string, unknown>)
        .project({ _id: 1, name: 1, username: 1, avatar: 1 })
        .toArray()
    : [];
  const crAuthorMap = new Map(crAuthorDocs.map((u) => [docId(u), u]));

  // Fetch prompt authors for change requests
  const crPromptAuthorIds = [...new Set(crPromptDocs.map((p) => (p as { authorId: string }).authorId))];
  const crPromptAuthorDocs = crPromptAuthorIds.length > 0
    ? await usersCol()
        .find({ _id: { $in: crPromptAuthorIds } } as Record<string, unknown>)
        .project({ _id: 1, name: 1, username: 1 })
        .toArray()
    : [];
  const crPromptAuthorMap = new Map(crPromptAuthorDocs.map((u) => [docId(u), u]));

  // Assemble change request objects
  const assembleChangeRequest = (cr: Record<string, unknown>, type: "submitted" | "received") => {
    const promptDoc = crPromptMap.get(cr.promptId as string);
    const promptAuthorDoc = promptDoc ? crPromptAuthorMap.get((promptDoc as { authorId: string }).authorId) : null;
    const authorDoc = crAuthorMap.get(cr.authorId as string);
    return {
      id: docId(cr as { _id: unknown }),
      status: cr.status as string,
      createdAt: cr.createdAt as Date,
      type,
      author: authorDoc
        ? { name: (authorDoc as { name?: string | null }).name ?? null, username: (authorDoc as { username: string }).username }
        : { name: null, username: cr.authorId as string },
      prompt: promptDoc
        ? {
            id: docId(promptDoc as { _id: unknown }),
            slug: (promptDoc as { slug?: string | null }).slug ?? null,
            title: (promptDoc as { title: string }).title,
            author: promptAuthorDoc
              ? { id: docId(promptAuthorDoc as { _id: unknown }), name: (promptAuthorDoc as { name?: string | null }).name ?? null, username: (promptAuthorDoc as { username: string }).username }
              : { id: (promptDoc as { authorId: string }).authorId, name: null, username: (promptDoc as { authorId: string }).authorId },
          }
        : { id: cr.promptId as string, slug: null, title: "Unknown", author: { id: "", name: null, username: "" } },
    };
  };

  const allChangeRequests = [
    ...submittedChangeRequests.map((cr) => assembleChangeRequest(cr as unknown as Record<string, unknown>, "submitted")),
    ...receivedChangeRequests.map((cr) => assembleChangeRequest(cr as unknown as Record<string, unknown>, "received")),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount =
    submittedChangeRequests.filter((cr) => cr.status === "PENDING").length +
    receivedChangeRequests.filter((cr) => (cr as { status?: string }).status === "PENDING").length;

  const defaultTab =
    tab === "changes" ? "changes"
    : tab === "contributions" ? "contributions"
    : tab === "likes" ? "likes"
    : tab === "examples" ? "examples"
    : "prompts";

  const totalPages = Math.ceil(total / perPage);
  const totalUpvotes = totalUpvotesResult as number;

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

  return (
    <div className="container py-6">
      {/* Profile Header */}
      <div className="flex flex-col gap-4 mb-8">
        {/* Avatar + Name row */}
        <div className="flex items-center gap-4">
          <Avatar className="h-16 w-16 md:h-20 md:w-20 shrink-0">
            <AvatarImage src={userDoc.avatar || undefined} />
            <AvatarFallback className="text-xl md:text-2xl">
              {userDoc.name?.charAt(0) || userDoc.username.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl md:text-2xl font-bold truncate">{userDoc.name || userDoc.username}</h1>
              {userDoc.verified && (
                <BadgeCheck className="h-5 w-5 text-blue-500 shrink-0" />
              )}
              {!userDoc.verified && isOwner && !config.homepage?.useCloneBranding && (
                <Link
                  href="https://donate.stripe.com/aFa9AS5RJeAR23nej0dMI03"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/50 text-amber-600 dark:text-amber-400 hover:from-amber-500/30 hover:to-yellow-500/30 transition-colors"
                >
                  <BadgeCheck className="h-3 w-3" />
                  {t("getVerified")}
                </Link>
              )}
              {userDoc.role === "ADMIN" && (
                <ShieldCheck className="h-5 w-5 text-primary shrink-0" />
              )}
            </div>
            <p className="text-muted-foreground text-sm flex items-center gap-2 flex-wrap">
              @{userDoc.username}
              {isUnclaimed && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30 bg-amber-500/10">
                  {t("unclaimedUser")}
                </Badge>
              )}
            </p>
          </div>
          {/* Actions - desktop only */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            {config.features.mcp !== false && <McpServerPopup initialUsers={[userDoc.username]} showOfficialBranding={!config.homepage?.useCloneBranding} />}
            {isOwner && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings">
                  <Settings className="h-4 w-4 mr-1.5" />
                  {t("editProfile")}
                </Link>
              </Button>
            )}
          </div>
        </div>

        {/* Actions - mobile only */}
        <div className="md:hidden flex gap-2">
          {config.features.mcp !== false && <McpServerPopup initialUsers={[userDoc.username]} showOfficialBranding={!config.homepage?.useCloneBranding} />}
          {isOwner && (
            <Button variant="outline" size="sm" asChild className="flex-1">
              <Link href="/settings">
                <Settings className="h-4 w-4 mr-1.5" />
                {t("editProfile")}
              </Link>
            </Button>
          )}
        </div>

        {/* Bio and Social Links */}
        <ProfileLinks
          bio={userDoc.bio}
          customLinks={userDoc.customLinks as CustomLink[] | null}
          className="mb-2"
        />

        {/* Stats - stacked on mobile, inline on desktop */}
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6 text-sm">
          <div className="flex items-center gap-1.5">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{promptCountAll}</span>
            <span className="text-muted-foreground">{t("prompts").toLowerCase()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ArrowBigUp className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{totalUpvotes}</span>
            <span className="text-muted-foreground">{t("upvotesReceived")}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{contributionCount}</span>
            <span className="text-muted-foreground">{t("contributionsCount")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{t("joined")} {formatDistanceToNow(userDoc.createdAt, locale)}</span>
          </div>
        </div>
      </div>

      {/* Activity Chart - above tabs */}
      <div className="mb-6">
        <ActivityChartWrapper data={activityData} locale={locale} />
      </div>

      {/* Tabs for Prompts and Change Requests */}
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="prompts" className="gap-2">
            <FileText className="h-4 w-4" />
            {t("prompts")}
          </TabsTrigger>
          <TabsTrigger value="contributions" className="gap-2">
            <Users className="h-4 w-4" />
            {t("contributions")}
            {contributions.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {contributions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="likes" className="gap-2">
            <Heart className="h-4 w-4" />
            {t("likes")}
            {likedPrompts.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {likedPrompts.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="examples" className="gap-2">
            <ImageIcon className="h-4 w-4" />
            {t("examples")}
            {userExamples.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {userExamples.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="changes" className="gap-2">
            <GitPullRequest className="h-4 w-4" />
            {tChanges("title")}
            {isOwner && pendingCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1 text-xs">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="prompts">
          {/* Date Filter Indicator */}
          {validFilterDateStart && (
            <div className="flex items-center gap-2 mb-4 p-3 bg-primary/10 border border-primary/20 rounded-lg">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-sm">
                {t("filteringByDate", { date: validFilterDateStart.toLocaleDateString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) })}
              </span>
              <Link
                href={`/@${userDoc.username}`}
                className="ml-auto text-xs text-primary hover:underline"
              >
                {t("clearFilter")}
              </Link>
            </div>
          )}

          {/* Private Prompts MCP Note - only shown to owner with private prompts */}
          {isOwner && <PrivatePromptsNote count={privatePromptsCount} />}

          {/* Pinned Prompts Section */}
          {pinnedPrompts.length > 0 && (
            <div className="mb-6 pb-6 border-b">
              <div className="flex items-center gap-2 mb-3">
                <Pin className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-medium">{tPrompts("pinnedPrompts")}</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pinnedPrompts.map((prompt: PromptCardProps["prompt"]) => (
                  <PromptCard key={prompt.id} prompt={prompt} showPinButton={isOwner} isPinned={isOwner} />
                ))}
              </div>
            </div>
          )}

          {prompts.length === 0 && pinnedPrompts.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/30">
              {validFilterDateStart ? (
                <>
                  <p className="text-muted-foreground">
                    {isOwner ? t("noPromptsOnDateOwner") : t("noPromptsOnDate")}
                  </p>
                  {isOwner && (
                    <Button asChild className="mt-4" size="sm">
                      <Link href="/prompts/new">{t("createForToday")}</Link>
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">{isOwner ? t("noPromptsOwner") : t("noPrompts")}</p>
                  {isOwner && (
                    <Button asChild className="mt-4" size="sm">
                      <Link href="/prompts/new">{t("createFirstPrompt")}</Link>
                    </Button>
                  )}
                </>
              )}
            </div>
          ) : prompts.length > 0 ? (
            <>
              {pinnedPrompts.length > 0 && (
                <h3 className="text-sm font-medium mb-3">{t("allPrompts")}</h3>
              )}
              <PromptList
                prompts={prompts}
                currentPage={page}
                totalPages={totalPages}
                pinnedIds={pinnedIds}
                showPinButton={isOwner}
              />
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="contributions">
          {contributions.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/30">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{isOwner ? t("noContributionsOwner") : t("noContributions")}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {contributions.map((prompt: PromptCardProps["prompt"]) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="likes">
          {likedPrompts.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/30">
              <Heart className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{isOwner ? t("noLikesOwner") : t("noLikes")}</p>
            </div>
          ) : (
            <Masonry columnCount={{ default: 1, md: 2, lg: 3 }} gap={16}>
              {likedPrompts.map((prompt: PromptCardProps["prompt"]) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </Masonry>
          )}
        </TabsContent>

        <TabsContent value="examples">
          {userExamples.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/30">
              <ImageIcon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{isOwner ? t("noExamplesOwner") : t("noExamples")}</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {userExamples.map((prompt: PromptCardProps["prompt"]) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="changes">
          {allChangeRequests.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/30">
              <GitPullRequest className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">{tChanges("noRequests")}</p>
            </div>
          ) : (
            <div className="divide-y border rounded-lg">
              {allChangeRequests.map((cr) => {
                const StatusIcon = statusIcons[cr.status as keyof typeof statusIcons];
                return (
                  <Link
                    key={cr.id}
                    href={`${getPromptUrl(cr.prompt.id, cr.prompt.slug)}/changes/${cr.id}`}
                    className="flex items-center justify-between px-3 py-2 hover:bg-accent/50 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{cr.prompt.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {cr.type === "submitted"
                          ? tChanges("submittedTo", { author: cr.prompt.author?.name || cr.prompt.author?.username })
                          : tChanges("receivedFrom", { author: cr.author.name || cr.author.username })
                        }
                        {" · "}
                        {formatDistanceToNow(cr.createdAt, locale)}
                      </p>
                    </div>
                    <Badge className={`ml-2 shrink-0 ${statusColors[cr.status as keyof typeof statusColors]}`}>
                      <StatusIcon className="h-3 w-3 mr-1" />
                      {tChanges(cr.status.toLowerCase())}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper to override mediaUrl in formatted prompts with the user's specific example
function userExamples_override(
  rawDocs: Array<{ _id: unknown; userExamples?: Array<{ userId: string; mediaUrl: string }> }>,
  formatted: PromptForCard[],
  userId: string
): PromptForCard[] {
  return formatted.map((p, i) => {
    const raw = rawDocs[i];
    const example = raw?.userExamples?.find((e) => e.userId === userId);
    if (example) {
      return { ...p, mediaUrl: example.mediaUrl };
    }
    return p;
  });
}
