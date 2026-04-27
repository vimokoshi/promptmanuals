import { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol, categoriesCol, tagsCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { PromptForm } from "@/components/prompts/prompt-form";
import { isAIGenerationEnabled, getAIModelName } from "@/lib/ai/generation";

interface EditPromptPageProps {
  params: Promise<{ id: string }>;
}

/**
 * Extracts the prompt ID from a URL parameter that may contain a slug
 */
function extractPromptId(idParam: string): string {
  const underscoreIndex = idParam.indexOf("_");
  if (underscoreIndex !== -1) {
    return idParam.substring(0, underscoreIndex);
  }
  return idParam;
}

export const metadata: Metadata = {
  title: "Edit Prompt",
  description: "Edit your prompt",
};

export default async function EditPromptPage({ params }: EditPromptPageProps) {
  const { id: idParam } = await params;
  const id = extractPromptId(idParam);
  const session = await auth();
  const t = await getTranslations("prompts");

  if (!session?.user) {
    redirect("/login");
  }

  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    notFound();
  }

  const doc = await promptsCol().findOne({ _id: oid });

  if (!doc) {
    notFound();
  }

  // Check if user is the author or admin
  const promptStringId = docId(doc);
  const isAuthor = doc.authorId === session.user.id;
  const isAdmin = session.user.role === "ADMIN";

  if (!isAuthor && !isAdmin) {
    redirect(`/prompts/${promptStringId}`);
  }

  // Fetch categories and tags for the form
  const [categoriesDocs, tagsDocs] = await Promise.all([
    categoriesCol().find({}).sort({ order: 1, name: 1 }).toArray(),
    tagsCol().find({}).sort({ name: 1 }).toArray(),
  ]);

  const categories = categoriesDocs.map((c) => ({
    id: docId(c),
    name: c.name,
    slug: c.slug,
    parentId: c.parentId,
  }));

  const tags = tagsDocs.map((tag) => ({
    id: docId(tag),
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
  }));

  // Transform prompt data for the form
  const initialData = {
    title: doc.title,
    description: doc.description || "",
    content: doc.content,
    type: ((doc.type === "IMAGE" || doc.type === "VIDEO" || doc.type === "AUDIO" || doc.type === "SKILL" || doc.type === "TASTE") ? doc.type : "TEXT") as "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "SKILL" | "TASTE",
    structuredFormat: doc.structuredFormat ? (doc.structuredFormat as "JSON" | "YAML") : undefined,
    categoryId: doc.categoryId || undefined,
    tagIds: doc.tags.map((embTag) => embTag._id as unknown as string),
    isPrivate: doc.isPrivate,
    mediaUrl: doc.mediaUrl || "",
    requiresMediaUpload: doc.requiresMediaUpload,
    requiredMediaType: (doc.requiredMediaType as "IMAGE" | "VIDEO" | "DOCUMENT") || "IMAGE",
    requiredMediaCount: doc.requiredMediaCount || 1,
    bestWithModels: doc.bestWithModels || [],
    bestWithMCP: doc.bestWithMCP || [],
    workflowLink: doc.workflowLink || "",
  };

  // The edit form expects contributors — MongoDB doc doesn't embed contributors,
  // so we pass an empty array (contributors are tracked separately in the API).
  const initialContributors: Array<{ id: string; username: string; name: string | null; avatar: string | null }> = [];

  // Check if AI generation is enabled
  const aiGenerationEnabled = await isAIGenerationEnabled();
  const aiModelName = getAIModelName();

  // Suppress unused variable warning from translation import
  void t;

  return (
    <div className="container max-w-3xl py-8">
      <PromptForm
        categories={categories}
        tags={tags}
        initialData={initialData}
        initialContributors={initialContributors}
        promptId={promptStringId}
        mode="edit"
        aiGenerationEnabled={aiGenerationEnabled}
        aiModelName={aiModelName}
      />
    </div>
  );
}
