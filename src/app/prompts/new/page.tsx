import { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Info } from "lucide-react";
import { auth } from "@/lib/auth";
import { PromptForm } from "@/components/prompts/prompt-form";
import { categoriesCol, tagsCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { isAIGenerationEnabled, getAIModelName } from "@/lib/ai/generation";
import { Alert, AlertDescription } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Create Prompt",
  description: "Create a new prompt",
};

interface PageProps {
  searchParams: Promise<{ 
    prompt?: string; 
    title?: string; 
    content?: string;
    type?: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "SKILL" | "TASTE";
    format?: "JSON" | "YAML";
  }>;
}

export default async function NewPromptPage({ searchParams }: PageProps) {
  const session = await auth();
  const t = await getTranslations("prompts");
  const { prompt: initialPromptRequest, title, content, type, format } = await searchParams;

  if (!session?.user) {
    redirect("/login");
  }

  const [categoryDocs, tagDocs] = await Promise.all([
    categoriesCol()
      .find({}, { projection: { name: 1, slug: 1, parentId: 1 } })
      .sort({ order: 1, name: 1 })
      .toArray(),
    tagsCol()
      .find({}, { projection: { name: 1, slug: 1, color: 1 } })
      .sort({ name: 1 })
      .toArray(),
  ]);

  const categories = categoryDocs.map((c) => ({
    id: docId(c),
    name: c.name,
    slug: c.slug,
    parentId: c.parentId ?? null,
  }));

  const tags = tagDocs.map((t) => ({
    id: docId(t),
    name: t.name,
    slug: t.slug,
    color: t.color,
  }));

  // Check if AI generation is enabled
  const aiGenerationEnabled = await isAIGenerationEnabled();
  const aiModelName = getAIModelName();

  return (
    <div className="container max-w-3xl py-8">
      <Alert className="mb-6">
        <Info className="h-4 w-4" />
        <AlertDescription>
          {t("createInfo")}
        </AlertDescription>
      </Alert>
      <PromptForm 
        categories={categories} 
        tags={tags} 
        aiGenerationEnabled={aiGenerationEnabled}
        aiModelName={aiModelName}
        initialPromptRequest={initialPromptRequest}
        initialData={(title || content || type || format) ? { 
          title: title || "", 
          content: content || "",
          type: type || "TEXT",
          structuredFormat: format || undefined,
        } : undefined}
      />
    </div>
  );
}
