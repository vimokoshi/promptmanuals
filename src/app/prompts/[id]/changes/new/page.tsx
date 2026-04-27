import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { ChangeRequestForm } from "@/components/prompts/change-request-form";

interface NewChangeRequestPageProps {
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

export default async function NewChangeRequestPage({ params }: NewChangeRequestPageProps) {
  const session = await auth();
  const t = await getTranslations("changeRequests");

  if (!session?.user) {
    redirect("/login");
  }

  const { id: idParam } = await params;
  const id = extractPromptId(idParam);

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

  const promptId = docId(doc);

  // Can't create change request for own prompt
  if (doc.authorId === session.user.id) {
    redirect(`/prompts/${promptId}`);
  }

  // Can't create change request for private prompt
  if (doc.isPrivate) {
    notFound();
  }

  return (
    <div className="container max-w-3xl py-6">
      {/* Header */}
      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4 -ml-2">
          <Link href={`/prompts/${promptId}`}>
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            {t("backToPrompt")}
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">{t("create")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {doc.title}
        </p>
      </div>

      {/* Form */}
      <ChangeRequestForm
        promptId={promptId}
        currentContent={doc.content}
        currentTitle={doc.title}
        promptType={doc.type}
        structuredFormat={doc.structuredFormat}
      />
    </div>
  );
}
