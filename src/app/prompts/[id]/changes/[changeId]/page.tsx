import { notFound } from "next/navigation";
import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { formatDistanceToNow } from "@/lib/date";
import { ArrowLeft, Clock, Check, X, FileText } from "lucide-react";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { changeRequestsCol, promptsCol, usersCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DiffView } from "@/components/ui/diff-view";
import { SkillDiffViewer } from "@/components/prompts/skill-diff-viewer";
import { ChangeRequestActions } from "@/components/prompts/change-request-actions";
import { ReopenChangeRequestButton } from "@/components/prompts/reopen-change-request-button";
import { DismissChangeRequestButton } from "@/components/prompts/dismiss-change-request-button";

interface ChangeRequestPageProps {
  params: Promise<{ id: string; changeId: string }>;
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

export default async function ChangeRequestPage({ params }: ChangeRequestPageProps) {
  const session = await auth();
  const t = await getTranslations("changeRequests");
  const locale = await getLocale();
  const { id: idParam, changeId } = await params;
  const promptId = extractPromptId(idParam);

  let changeOid: ObjectId;
  try {
    changeOid = new ObjectId(changeId);
  } catch {
    notFound();
  }

  const changeRequest = await changeRequestsCol().findOne({ _id: changeOid });

  if (!changeRequest) {
    notFound();
  }

  // Verify this change request belongs to the correct prompt
  if (changeRequest.promptId !== promptId) {
    // Try to look up by ObjectId too in case promptId is stored differently
    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      notFound();
    }
    const promptDoc = await promptsCol().findOne({ _id: promptOid });
    if (!promptDoc || changeRequest.promptId !== docId(promptDoc)) {
      notFound();
    }
  }

  // Fetch author and prompt details in parallel
  const [authorDoc, promptDoc] = await Promise.all([
    usersCol().findOne({ _id: { $in: [changeRequest.authorId] } } as Record<string, unknown>),
    promptsCol().findOne({ _id: { $in: [changeRequest.promptId] } } as Record<string, unknown>),
  ]);

  if (!promptDoc) {
    notFound();
  }

  const changeRequestId = docId(changeRequest);
  const author = authorDoc
    ? {
        id: docId(authorDoc),
        name: authorDoc.name,
        username: authorDoc.username,
        avatar: authorDoc.avatar,
      }
    : {
        id: changeRequest.authorId,
        name: null,
        username: changeRequest.authorId,
        avatar: null,
      };

  const prompt = {
    id: docId(promptDoc),
    title: promptDoc.title,
    content: promptDoc.content,
    authorId: promptDoc.authorId,
    type: promptDoc.type,
  };

  const isPromptOwner = session?.user?.id === prompt.authorId;
  const isChangeRequestAuthor = session?.user?.id === author.id;

  const statusConfig = {
    PENDING: {
      color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
      icon: Clock,
    },
    APPROVED: {
      color: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
      icon: Check,
    },
    REJECTED: {
      color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
      icon: X,
    },
  };

  const StatusIcon = statusConfig[changeRequest.status].icon;
  const hasTitleChange = changeRequest.proposedTitle && changeRequest.proposedTitle !== changeRequest.originalTitle;

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

        {/* Title and status */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold">{t("title")}</h1>
              <Badge className={statusConfig[changeRequest.status].color}>
                <StatusIcon className="h-3 w-3 mr-1" />
                {t(changeRequest.status.toLowerCase())}
              </Badge>
            </div>
            <Link
              href={`/prompts/${promptId}`}
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 mt-1"
            >
              <FileText className="h-3.5 w-3.5" />
              {prompt.title}
            </Link>
          </div>
        </div>

        {/* Author and time */}
        <div className="flex items-center gap-2 mt-4 pt-4 border-t">
          <Avatar className="h-6 w-6">
            <AvatarImage src={author.avatar || ""} />
            <AvatarFallback className="text-xs">{author.name?.[0] || author.username[0]}</AvatarFallback>
          </Avatar>
          <span className="text-sm">
            <Link href={`/@${author.username}`} className="font-medium hover:underline">
              @{author.username}
            </Link>
            <span className="text-muted-foreground"> · {formatDistanceToNow(changeRequest.createdAt, locale)}</span>
          </span>
        </div>
      </div>

      {/* Reason */}
      {changeRequest.reason && (
        <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("reason")}</p>
          <p className="text-sm whitespace-pre-wrap">{changeRequest.reason}</p>
        </div>
      )}

      {/* Title change */}
      {hasTitleChange && (
        <div className="mb-6 p-4 bg-muted/30 rounded-lg border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("titleChange")}</p>
          <div className="text-sm">
            <span className="text-red-600 dark:text-red-400 line-through">{changeRequest.originalTitle}</span>
            <span className="text-muted-foreground mx-2">→</span>
            <span className="text-green-600 dark:text-green-400">{changeRequest.proposedTitle}</span>
          </div>
        </div>
      )}

      {/* Content diff */}
      <div className="mb-6">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">{t("contentChanges")}</p>
        {prompt.type === "SKILL" ? (
          <SkillDiffViewer
            original={changeRequest.originalContent}
            modified={changeRequest.proposedContent}
          />
        ) : (
          <DiffView
            original={changeRequest.originalContent}
            modified={changeRequest.proposedContent}
          />
        )}
      </div>

      {/* Review note (if exists) */}
      {changeRequest.reviewNote && (
        <div className="mb-6 p-4 rounded-lg border border-blue-500/20 bg-blue-500/5">
          <p className="text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wide mb-2">{t("reviewNote")}</p>
          <p className="text-sm whitespace-pre-wrap">{changeRequest.reviewNote}</p>
        </div>
      )}

      {/* Actions for prompt owner */}
      {isPromptOwner && changeRequest.status === "PENDING" && (
        <div className="pt-4 border-t">
          <ChangeRequestActions changeRequestId={changeRequestId} promptId={promptId} />
        </div>
      )}

      {/* Reopen button for rejected requests */}
      {isPromptOwner && changeRequest.status === "REJECTED" && (
        <div className="pt-4 border-t">
          <ReopenChangeRequestButton changeRequestId={changeRequestId} promptId={promptId} />
        </div>
      )}

      {/* Dismiss button for change request author (pending only) */}
      {isChangeRequestAuthor && changeRequest.status === "PENDING" && (
        <div className="pt-4 border-t">
          <DismissChangeRequestButton changeRequestId={changeRequestId} promptId={promptId} />
        </div>
      )}
    </div>
  );
}
