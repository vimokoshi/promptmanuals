import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { getLocale } from "next-intl/server";
import { formatDistanceToNow } from "@/lib/date";
import { StructuredData } from "@/components/seo/structured-data";
import { InteractivePromptContent } from "@/components/prompts/interactive-prompt-content";
import { PromptLanguageRow } from "@/components/prompts/prompt-language-row";
import { UpvoteButton } from "@/components/prompts/upvote-button";
import { ShareDropdown } from "@/components/prompts/share-dropdown";
import { TestPromptSidebar } from "@/components/prompts/test-prompt-sidebar";
import { AnimatedDate } from "@/components/ui/animated-date";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Globe } from "lucide-react";

const SUPPORTED_LANGS = ["es","zh","ja","de","fr","pt","ko","tr","ar","ru","hi","bn","ta","te","mr","gu"] as const;
type SupportedLang = typeof SUPPORTED_LANGS[number];

const LANG_NAMES: Record<SupportedLang, string> = {
  es: "Español", zh: "中文", ja: "日本語", de: "Deutsch",
  fr: "Français", pt: "Português", ko: "한국어", tr: "Türkçe",
  ar: "العربية", ru: "Русский", hi: "हिन्दी", bn: "বাংলা",
  ta: "தமிழ்", te: "తెలుగు", mr: "मराठी", gu: "ગુજરાતી",
};

interface PageProps {
  params: Promise<{ id: string; lang: string }>;
}

function extractPromptId(idParam: string): string {
  const idx = idParam.indexOf("_");
  return idx !== -1 ? idParam.substring(0, idx) : idParam;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: idParam, lang } = await params;
  if (!SUPPORTED_LANGS.includes(lang as SupportedLang)) return { title: "Not Found" };

  const id = extractPromptId(idParam);

  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    return { title: "Not Found" };
  }

  const doc = await promptsCol().findOne(
    { _id: oid, deletedAt: null },
    { projection: { title: 1, slug: 1, translations: 1, categoryId: 1 } }
  );
  if (!doc) return { title: "Not Found" };

  const translations = doc.translations as Record<string, { title?: string; content?: string }> | null;
  const t = translations?.[lang];
  if (!t?.title) return { title: "Not Found" };

  // Fetch category name if needed
  let categoryName = "AI";
  if (doc.categoryId) {
    const cat = await categoriesCol().findOne(
      { _id: { $in: [doc.categoryId] } } as Record<string, unknown>,
      { projection: { name: 1 } }
    );
    if (cat) categoryName = cat.name;
  }

  const promptStringId = docId(doc);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
  const canonicalUrl = `${baseUrl}/prompts/${promptStringId}_${doc.slug}/${lang}`;
  const englishUrl = `${baseUrl}/prompts/${promptStringId}_${doc.slug}`;
  const langName = LANG_NAMES[lang as SupportedLang];
  const title = `${t.title} — ${categoryName} AI Prompt in ${langName} | Prompt Manuals`;
  const description = t.content ? `${t.content.substring(0, 160)}...` : title;

  const langAlternates: Record<string, string> = { "x-default": englishUrl, en: englishUrl };
  if (translations) {
    for (const l of SUPPORTED_LANGS) {
      if (translations[l]?.title) {
        langAlternates[l] = `${baseUrl}/prompts/${promptStringId}_${doc.slug}/${l}`;
      }
    }
  }

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl, languages: langAlternates },
    openGraph: { title, description, url: canonicalUrl, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TranslatedPromptPage({ params }: PageProps) {
  const { id: idParam, lang } = await params;
  if (!SUPPORTED_LANGS.includes(lang as SupportedLang)) notFound();

  const id = extractPromptId(idParam);
  const [session, locale] = await Promise.all([auth(), getLocale()]);

  let oid: ObjectId;
  try {
    oid = new ObjectId(id);
  } catch {
    notFound();
  }

  const doc = await promptsCol().findOne({ _id: oid, deletedAt: null, isPrivate: false });

  if (!doc) notFound();

  const translations = doc.translations as Record<string, { title?: string; content?: string }> | null;
  const t = translations?.[lang];
  if (!t?.title || !t?.content) notFound();

  // Fetch author and category in parallel
  const [authorDoc, categoryDoc] = await Promise.all([
    usersCol().findOne({ _id: { $in: [doc.authorId] } } as Record<string, unknown>),
    doc.categoryId
      ? categoriesCol().findOne({ _id: { $in: [doc.categoryId] } } as Record<string, unknown>)
      : Promise.resolve(null),
  ]);

  const promptStringId = docId(doc);
  const langName = LANG_NAMES[lang as SupportedLang];
  const englishUrl = `/prompts/${promptStringId}_${doc.slug}`;
  const voteCount = doc.voteCount;

  // Check if user has voted
  const hasVoted = session?.user
    ? doc.votes.some((v) => v.userId === session.user!.id)
    : false;

  const author = authorDoc
    ? {
        id: docId(authorDoc),
        name: authorDoc.name,
        username: authorDoc.username,
        avatar: authorDoc.avatar,
      }
    : {
        id: doc.authorId,
        name: null,
        username: doc.authorId,
        avatar: null,
      };

  const category = categoryDoc
    ? { name: categoryDoc.name, slug: categoryDoc.slug }
    : null;

  const tags = doc.tags.map((embTag) => ({
    tag: {
      id: embTag._id as unknown as string,
      name: embTag.name,
      slug: embTag.slug,
      color: embTag.color,
    },
  }));

  return (
    <>
      <StructuredData
        type="breadcrumb"
        data={{
          breadcrumbs: [
            { name: "Home", url: "/" },
            { name: "Prompts", url: "/prompts" },
            ...(category ? [{ name: category.name, url: `/categories/${category.slug}` }] : []),
            { name: doc.title, url: englishUrl },
            { name: langName, url: `${englishUrl}/${lang}` },
          ],
        }}
      />
      <StructuredData
        type="faq"
        data={{
          faq: [
            {
              question: `What is the ${t.title} prompt?`,
              answer: `${t.title} — ${category?.name ?? "AI"} prompt available in ${langName} on Prompt Manuals.`,
            },
            {
              question: `How do I use the ${t.title} prompt?`,
              answer: `Copy the ${langName} prompt text, paste it into ChatGPT, Claude, Gemini, or any AI assistant, and send it.`,
            },
          ],
        }}
      />

      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-8 items-start">
          <div>
            {/* Language notice */}
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-4">
              <Globe className="h-3.5 w-3.5" />
              <Link href={englishUrl} className="hover:underline">English</Link>
              <span>/</span>
              <span className="font-medium text-foreground">{langName}</span>
            </div>

            {/* Header */}
            <div className="mb-6">
              <div className="flex items-center gap-4 mb-2">
                <div className="shrink-0">
                  <UpvoteButton
                    promptId={promptStringId}
                    initialVoted={hasVoted}
                    initialCount={voteCount}
                    isLoggedIn={!!session?.user}
                    size="circular"
                  />
                </div>
                <div className="flex-1 flex items-center justify-between gap-4 min-w-0">
                  <h1 className="text-3xl font-bold">{t.title}</h1>
                  <ShareDropdown
                    promptId={promptStringId}
                    title={t.title}
                    url={`/prompts/${promptStringId}_${doc.slug}/${lang}`}
                  />
                </div>
              </div>
              {doc.description && (
                <p className="text-muted-foreground">{doc.description}</p>
              )}
            </div>

            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
              <div className="flex items-center gap-2">
                <Link href={`/@${author.username}`} title={`@${author.username}`}>
                  <Avatar className="h-6 w-6 border-2 border-background">
                    <AvatarImage src={author.avatar || undefined} />
                    <AvatarFallback className="text-xs">
                      {author.name?.charAt(0) || author.username.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
                <Link href={`/@${author.username}`} className="hover:underline">
                  @{author.username}
                </Link>
              </div>
              <AnimatedDate
                date={doc.createdAt}
                relativeText={formatDistanceToNow(doc.createdAt, locale)}
                locale={locale}
              />
            </div>

            {/* Category and Tags */}
            {(category || tags.length > 0) && (
              <div className="flex flex-wrap items-center gap-2 mb-6">
                {category && (
                  <Link href={`/categories/${category.slug}`}>
                    <Badge variant="outline">{category.name}</Badge>
                  </Link>
                )}
                {category && tags.length > 0 && (
                  <span className="text-muted-foreground">•</span>
                )}
                {tags.map(({ tag }) => (
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

            {/* Translated prompt content */}
            <InteractivePromptContent
              content={t.content}
              promptId={promptStringId}
              shareTitle={t.title}
              promptTitle={t.title}
              promptDescription={doc.description ?? undefined}
            />

            {/* Language switcher */}
            <PromptLanguageRow
              currentLocale={lang}
              promptId={promptStringId}
              promptSlug={doc.slug ?? ""}
              translations={translations}
            />
          </div>

          {/* Sidebar */}
          <TestPromptSidebar content={t.content} />
        </div>
      </div>
    </>
  );
}
