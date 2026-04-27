import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { usersCol, promptsCol, categoriesCol, tagsCol, webhookConfigsCol } from "@/lib/mongodb";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FolderTree, Tags, FileText } from "lucide-react";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { UsersTable } from "@/components/admin/users-table";
import { CategoriesTable } from "@/components/admin/categories-table";
import { TagsTable } from "@/components/admin/tags-table";
import { WebhooksTable } from "@/components/admin/webhooks-table";
import { PromptsManagement } from "@/components/admin/prompts-management";
import { ReportsTable } from "@/components/admin/reports-table";
import { isAISearchEnabled } from "@/lib/ai/embeddings";

export const metadata: Metadata = {
  title: "Admin Dashboard",
  description: "Manage your application",
};

export default async function AdminPage() {
  const session = await auth();
  const t = await getTranslations("admin");

  // Check if user is admin
  if (!session?.user || session.user.role !== "ADMIN") {
    redirect("/");
  }

  // Fetch stats and AI search status
  const [userCount, promptCount, categoryCount, tagCount, aiSearchEnabled] = await Promise.all([
    usersCol().countDocuments(),
    promptsCol().countDocuments(),
    categoriesCol().countDocuments(),
    tagsCol().countDocuments(),
    isAISearchEnabled(),
  ]);

  // Count prompts without embeddings and total public prompts
  let promptsWithoutEmbeddings = 0;
  let totalPublicPrompts = 0;
  if (aiSearchEnabled) {
    [promptsWithoutEmbeddings, totalPublicPrompts] = await Promise.all([
      promptsCol().countDocuments({ isPrivate: false, deletedAt: null, embedding: null }),
      promptsCol().countDocuments({ isPrivate: false, deletedAt: null }),
    ]);
  }

  // Count prompts without slugs
  const [promptsWithoutSlugs, totalPrompts] = await Promise.all([
    promptsCol().countDocuments({ slug: null, deletedAt: null }),
    promptsCol().countDocuments({ deletedAt: null }),
  ]);

  // Fetch categories with prompt counts and children counts
  const allCategories = await categoriesCol().find({}).sort({ parentId: 1, order: 1 }).toArray();
  const allCategoryIds = allCategories.map(c => c._id.toHexString());

  const promptCountsAgg = await promptsCol().aggregate([
    { $match: { categoryId: { $in: allCategoryIds } } },
    { $group: { _id: "$categoryId", count: { $sum: 1 } } },
  ]).toArray();
  const promptCountMap: Record<string, number> = Object.fromEntries(
    promptCountsAgg.map(p => [p._id, p.count])
  );

  const childrenCountMap: Record<string, number> = {};
  allCategories.forEach(c => {
    if (c.parentId) {
      childrenCountMap[c.parentId] = (childrenCountMap[c.parentId] || 0) + 1;
    }
  });

  const categories = allCategories.map(c => {
    const id = c._id.toHexString();
    const parent = c.parentId
      ? allCategories.find(p => p._id.toHexString() === c.parentId) ?? null
      : null;
    return {
      ...c,
      id,
      _count: { prompts: promptCountMap[id] || 0, children: childrenCountMap[id] || 0 },
      parent: parent ? { id: parent._id.toHexString(), name: parent.name } : null,
    };
  });

  // Fetch tags with prompt counts (tags embedded in prompt.tags[])
  const allTags = await tagsCol().find({}).sort({ name: 1 }).toArray();
  const tagIds = allTags.map(t => t._id.toHexString());

  const tagPromptCountsAgg = await promptsCol().aggregate([
    { $unwind: "$tags" },
    { $match: { "tags._id": { $in: tagIds } } },
    { $group: { _id: "$tags._id", count: { $sum: 1 } } },
  ]).toArray();
  const tagCountMap: Record<string, number> = Object.fromEntries(
    tagPromptCountsAgg.map(t => [t._id, t.count])
  );

  const tags = allTags.map(t => ({
    ...t,
    id: t._id.toHexString(),
    _count: { prompts: tagCountMap[t._id.toHexString()] || 0 },
  }));

  // Fetch webhooks
  const webhookDocs = await webhookConfigsCol().find({}).sort({ createdAt: -1 }).toArray();
  const webhooks = webhookDocs.map(w => ({ ...w, id: w._id.toHexString() }));

  // Fetch reports (embedded in prompts)
  const promptsWithReports = await promptsCol().find(
    { reports: { $exists: true, $not: { $size: 0 } } },
    { projection: { _id: 1, slug: 1, title: 1, isUnlisted: 1, deletedAt: 1, reports: 1, authorId: 1 } }
  ).sort({ "reports.createdAt": -1 }).toArray();

  const reports = promptsWithReports
    .flatMap(p =>
      (p.reports ?? []).map(r => ({
        ...r,
        id: r._id,
        prompt: {
          id: p._id.toHexString(),
          slug: p.slug,
          title: p.title,
          isUnlisted: p.isUnlisted,
          deletedAt: p.deletedAt,
        },
        reporter: { id: r.reporterId, username: "", name: null, avatar: null },
      }))
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="container py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.users")}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{userCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.prompts")}</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{promptCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.categories")}</CardTitle>
            <FolderTree className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{categoryCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{t("stats.tags")}</CardTitle>
            <Tags className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tagCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Management Tabs */}
      <AdminTabs
        translations={{
          users: t("tabs.users"),
          categories: t("tabs.categories"),
          tags: t("tabs.tags"),
          webhooks: t("tabs.webhooks"),
          prompts: t("tabs.prompts"),
          reports: t("tabs.reports"),
        }}
        pendingReportsCount={reports.filter(r => r.status === "PENDING").length}
        children={{
          users: <UsersTable />,
          categories: <CategoriesTable categories={categories} />,
          tags: <TagsTable tags={tags} />,
          webhooks: <WebhooksTable webhooks={webhooks} />,
          prompts: (
            <PromptsManagement
              aiSearchEnabled={aiSearchEnabled}
              promptsWithoutEmbeddings={promptsWithoutEmbeddings}
              totalPublicPrompts={totalPublicPrompts}
              promptsWithoutSlugs={promptsWithoutSlugs}
              totalPrompts={totalPrompts}
            />
          ),
          reports: <ReportsTable reports={reports} />,
        }}
      />
    </div>
  );
}
