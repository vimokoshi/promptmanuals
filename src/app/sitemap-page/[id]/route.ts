import { NextResponse } from "next/server";
import { promptsCol, categoriesCol, tagsCol } from "@/lib/mongodb";
import type { TranslationEntry } from "@/lib/mongodb";
import { getAllChapters } from "@/lib/book/chapters";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
const TRANSLATED_LANGS = ["es", "zh", "ja", "de", "fr", "pt", "ko", "ru", "hi", "bn", "ta", "te", "mr", "gu"];
const TRANSLATIONS_PAGE_SIZE = 50_000;
const PROMPTS_PER_TRANSLATION_PAGE = Math.ceil(TRANSLATIONS_PAGE_SIZE / TRANSLATED_LANGS.length);

type SitemapUrl = {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
};

function buildXml(urls: SitemapUrl[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
    .map(
      (u) =>
        `  <url>
    <loc>${u.loc}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ""}${u.changefreq ? `\n    <changefreq>${u.changefreq}</changefreq>` : ""}${u.priority !== undefined ? `\n    <priority>${u.priority}</priority>` : ""}
  </url>`
    )
    .join("\n")}
</urlset>`;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const numId = Number(rawId.replace(/\.xml$/i, ""));

  let urls: SitemapUrl[] = [];

  // ── 0: Static pages + book chapters ─────────────────────────────────
  if (numId === 0) {
    const chapters = getAllChapters();
    urls = [
      { loc: BASE_URL, lastmod: new Date().toISOString(), changefreq: "daily", priority: 1.0 },
      { loc: `${BASE_URL}/discover`, lastmod: new Date().toISOString(), changefreq: "daily", priority: 0.9 },
      { loc: `${BASE_URL}/categories`, lastmod: new Date().toISOString(), changefreq: "weekly", priority: 0.8 },
      { loc: `${BASE_URL}/tags`, lastmod: new Date().toISOString(), changefreq: "weekly", priority: 0.7 },
      { loc: `${BASE_URL}/book`, lastmod: new Date().toISOString(), changefreq: "weekly", priority: 0.8 },
      ...chapters.map((ch) => ({
        loc: `${BASE_URL}/book/${ch.slug}`,
        lastmod: new Date().toISOString(),
        changefreq: "monthly",
        priority: 0.7,
      })),
    ];
  }

  // ── 1: All English prompt pages ──────────────────────────────────────
  else if (numId === 1) {
    try {
      const prompts = await promptsCol()
        .find({ isPrivate: false, deletedAt: null, isUnlisted: false })
        .sort({ updatedAt: -1 })
        .project({ _id: 1, slug: 1, updatedAt: 1 })
        .toArray();
      urls = prompts.map((p) => ({
        loc: `${BASE_URL}/prompts/${p._id.toHexString()}_${p.slug}`,
        lastmod: (p.updatedAt as Date).toISOString(),
        changefreq: "weekly",
        priority: 0.8,
      }));
    } catch {
      urls = [];
    }
  }

  // ── 2: Category pages ────────────────────────────────────────────────
  else if (numId === 2) {
    try {
      const categories = await categoriesCol()
        .find({})
        .project({ slug: 1 })
        .toArray();
      urls = categories.map((c) => ({
        loc: `${BASE_URL}/categories/${c.slug}`,
        lastmod: new Date().toISOString(),
        changefreq: "weekly",
        priority: 0.7,
      }));
    } catch {
      urls = [];
    }
  }

  // ── 3: Tag pages ─────────────────────────────────────────────────────
  else if (numId === 3) {
    try {
      const tags = await tagsCol()
        .find({})
        .project({ slug: 1 })
        .toArray();
      urls = tags.map((t) => ({
        loc: `${BASE_URL}/tags/${t.slug}`,
        lastmod: new Date().toISOString(),
        changefreq: "weekly",
        priority: 0.6,
      }));
    } catch {
      urls = [];
    }
  }

  // ── 4+: Translated prompt pages (paginated) ──────────────────────────
  else if (numId >= 4) {
    const page = numId - 4;
    try {
      const prompts = await promptsCol()
        .find({ isPrivate: false, deletedAt: null, isUnlisted: false })
        .sort({ updatedAt: -1 })
        .skip(page * PROMPTS_PER_TRANSLATION_PAGE)
        .limit(PROMPTS_PER_TRANSLATION_PAGE)
        .project({ _id: 1, slug: 1, updatedAt: 1, translations: 1 })
        .toArray();

      urls = prompts.flatMap((prompt) => {
        const translations = (prompt.translations ?? []) as TranslationEntry[];
        const translatedLangs = new Set(translations.map((t) => t.lang));
        return TRANSLATED_LANGS.filter((lang) => translatedLangs.has(lang)).map((lang) => ({
          loc: `${BASE_URL}/prompts/${prompt._id.toHexString()}_${prompt.slug}/${lang}`,
          lastmod: (prompt.updatedAt as Date).toISOString(),
          changefreq: "monthly",
          priority: 0.6,
        }));
      });
    } catch {
      urls = [];
    }
  }

  return new NextResponse(buildXml(urls), {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
