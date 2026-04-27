import { NextResponse } from "next/server";
import { promptsCol } from "@/lib/mongodb";

export const revalidate = 3600;

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.promptmanuals.com";
const TRANSLATIONS_PAGE_SIZE = 50_000;
const TRANSLATED_LANGS_COUNT = 14;
const PROMPTS_PER_TRANSLATION_PAGE = Math.ceil(TRANSLATIONS_PAGE_SIZE / TRANSLATED_LANGS_COUNT);

export async function GET() {
  let translationSitemaps = 1;
  try {
    const total = await promptsCol().countDocuments({
      isPrivate: false,
      deletedAt: null,
      isUnlisted: false,
    });
    translationSitemaps = Math.max(1, Math.ceil(total / PROMPTS_PER_TRANSLATION_PAGE));
  } catch {
    // fallback covers ~4,601 prompts × 14 langs = 64,414 URLs
    translationSitemaps = 2;
  }

  const sitemapIds = [0, 1, 2, 3, ...Array.from({ length: translationSitemaps }, (_, i) => 4 + i)];
  const now = new Date().toISOString();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapIds.map((id) => `  <sitemap>
    <loc>${BASE_URL}/sitemap/${id}.xml</loc>
    <lastmod>${now}</lastmod>
  </sitemap>`).join("\n")}
</sitemapindex>`;

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
