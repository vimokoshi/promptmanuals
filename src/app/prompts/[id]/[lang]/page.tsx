import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
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
  ta: "தமிழ்", te: "తెలుగు", mr: "मराठी", gu: "ગુજરాతી",
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
  const prompt = await db.prompt.findUnique({
    where: { id, deletedAt: null },
    select: { title: true, slug: true, translations: true, category: { select: { name: true } } },
  });
  if (!prompt) return { title: "Not Found" };

  const translations = prompt.translations as Record<string, { title?: string; content?: string }> | null;
  const t = translations?.[lang];
  if (!t?.title) return { title: "Not Found" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
  const canonicalUrl = `${baseUrl}/prompts/${id}_${prompt.slug}/${lang}`;
  const englishUrl = `${baseUrl}/prompts/${id}_${prompt.slug}`;
  const langName = LANG_NAMES[lang as SupportedLang];
  const categoryName = prompt.category?.name || "AI";
  const title = `${t.title} — ${categoryName} AI Prompt in ${langName} | Prompt Manuals`;
  const description = t.content ? `${t.content.substring(0, 160)}...` : title;

  const langAlternates: Record<string, string> = { "x-default": englishUrl, en: englishUrl };
  if (translations) {
    for (const l of SUPPORTED_LANGS) {
      if (translations[l]?.title) {
        langAlternates[l] = `${baseUrl}/prompts/${id}_${prompt.slug}/${l}`;
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

  const prompt = await db.prompt.findFirst({
    where: { id, deletedAt: null, isPrivate: false },
    include: {
      author: { select: { id: true, name: true, username: true, avatar: true } },
      category: { include: { parent: true } },
      tags: { include: { tag: true } },
      _count: { select: { votes: true } },
    },
  });

  if (!prompt) notFound();

  const translations = prompt.translations as Record<string, { title?: string; content?: string }> | null;
  const t = translations?.[lang];
  if (!t?.title || !t?.content) notFound();

  const langName = LANG_NAMES[lang as SupportedLang];
  const englishUrl = `/prompts/${prompt.id}_${prompt.slug}`;
  const voteCount = prompt._count?.votes ?? 0;

  const userVote = session?.user
    ? await db.promptVote.findUnique({
        where: { userId_promptId: { userId: session.user.id, promptId: id } },
      })
    : null;
  const hasVoted = !!userVote;

  return (
    <>
      <StructuredData
        type="breadcrumb"
        data={{
          breadcrumbs: [
            { name: "Home", url: "/" },
            { name: "Prompts", url: "/prompts" },
            ...(prompt.category ? [{ name: prompt.category.name, url: `/categories/${prompt.category.slug}` }] : []),
            { name: prompt.title, url: englishUrl },
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
              answer: `${t.title} — ${prompt.category?.name ?? "AI"} prompt available in ${langName} on Prompt Manuals.`,
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
                    promptId={prompt.id}
                    initialVoted={hasVoted}
                    initialCount={voteCount}
                    isLoggedIn={!!session?.user}
                    size="circular"
                  />
                </div>
                <div className="flex-1 flex items-center justify-between gap-4 min-w-0">
                  <h1 className="text-3xl font-bold">{t.title}</h1>
                  <ShareDropdown
                    promptId={prompt.id}
                    title={t.title}
                    url={`/prompts/${prompt.id}_${prompt.slug}/${lang}`}
                  />
                </div>
              </div>
              {prompt.description && (
                <p className="text-muted-foreground">{prompt.description}</p>
              )}
            </div>

            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
              <div className="flex items-center gap-2">
                <Link href={`/@${prompt.author.username}`} title={`@${prompt.author.username}`}>
                  <Avatar className="h-6 w-6 border-2 border-background">
                    <AvatarImage src={prompt.author.avatar || undefined} />
                    <AvatarFallback className="text-xs">
                      {prompt.author.name?.charAt(0) || prompt.author.username.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </Link>
                <Link href={`/@${prompt.author.username}`} className="hover:underline">
                  @{prompt.author.username}
                </Link>
              </div>
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

            {/* Translated prompt content */}
            <InteractivePromptContent
              content={t.content}
              promptId={prompt.id}
              shareTitle={t.title}
              promptTitle={t.title}
              promptDescription={prompt.description ?? undefined}
            />

            {/* Language switcher */}
            <PromptLanguageRow
              currentLocale={lang}
              promptId={prompt.id}
              promptSlug={prompt.slug ?? ""}
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
