import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { StructuredData } from "@/components/seo/structured-data";
import { InteractivePromptContent } from "@/components/prompts/interactive-prompt-content";
import { PromptLanguageRow } from "@/components/prompts/prompt-language-row";

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

  // hreflang: English canonical + all other translated versions
  const langAlternates: Record<string, string> = {
    "x-default": englishUrl,
    en: englishUrl,
  };
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
    alternates: {
      canonical: canonicalUrl,
      languages: langAlternates,
    },
    openGraph: { title, description, url: canonicalUrl, type: "article" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function TranslatedPromptPage({ params }: PageProps) {
  const { id: idParam, lang } = await params;

  if (!SUPPORTED_LANGS.includes(lang as SupportedLang)) notFound();

  const id = extractPromptId(idParam);
  const prompt = await db.prompt.findFirst({
    where: { id, deletedAt: null, isPrivate: false },
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      content: true,
      translations: true,
      category: { select: { name: true, slug: true } },
      author: { select: { name: true, username: true } },
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!prompt) notFound();

  const translations = prompt.translations as Record<string, { title?: string; content?: string }> | null;
  const t = translations?.[lang];
  if (!t?.title || !t?.content) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
  const englishUrl = `/prompts/${prompt.id}_${prompt.slug}`;
  const langName = LANG_NAMES[lang as SupportedLang];

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

      <div className="container py-8 max-w-3xl">
        {/* Language notice */}
        <div className="mb-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Link href={englishUrl} className="hover:underline">
            English
          </Link>
          <span>/</span>
          <span className="font-medium text-foreground">{langName}</span>
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold mb-2">{t.title}</h1>

        {/* Original English description if available */}
        {prompt.description && (
          <p className="text-muted-foreground mb-6">{prompt.description}</p>
        )}

        {/* Translated prompt content */}
        <div className="mb-6">
          <InteractivePromptContent
            content={t.content}
            promptId={prompt.id}
            shareTitle={t.title}
            promptTitle={t.title}
          />
        </div>

        {/* Language switcher */}
        <PromptLanguageRow
          currentLocale={lang}
          promptId={prompt.id}
          promptSlug={prompt.slug ?? ""}
          translations={translations}
        />

        {/* Link back to English */}
        <div className="mt-6 pt-4 border-t text-sm text-muted-foreground">
          <Link href={englishUrl} className="hover:underline">
            View in English →
          </Link>
        </div>
      </div>
    </>
  );
}
