import { MetadataRoute } from "next";
import { promptsCol, categoriesCol, tagsCol } from "@/lib/mongodb";
import { getAllChapters } from "@/lib/book/chapters";

// Revalidate sitemap every hour (3600 seconds)
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXTAUTH_URL || "https://prompts.chat";

  // Static pages - always included
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/discover`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/categories`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/tags`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/book`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  // Book chapter pages
  const chapters = getAllChapters();
  const bookPages: MetadataRoute.Sitemap = chapters.map((chapter) => ({
    url: `${baseUrl}/book/${chapter.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly",
    priority: 0.7,
  }));

  const TRANSLATED_LANGS = ["es","zh","ja","de","fr","pt","ko","tr","ar","ru","hi","bn","ta","te","mr","gu"] as const;

  // Dynamic pages - skip if database is unavailable (e.g., during build)
  try {
    const [categories, prompts, tags] = await Promise.all([
      categoriesCol().find({}).project({ slug: 1 }).toArray(),
      promptsCol()
        .find({ isPrivate: false, deletedAt: null, isUnlisted: false })
        .project({ _id: 1, slug: 1, updatedAt: 1, translations: 1 })
        .sort({ updatedAt: -1 })
        .limit(1000)
        .toArray(),
      tagsCol().find({}).project({ slug: 1 }).toArray(),
    ]);

    const categoryPages: MetadataRoute.Sitemap = categories.map((category) => ({
      url: `${baseUrl}/categories/${category.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    }));

    const promptPages: MetadataRoute.Sitemap = prompts.map((prompt) => ({
      url: `${baseUrl}/prompts/${prompt._id.toHexString()}_${prompt.slug}`,
      lastModified: prompt.updatedAt,
      changeFrequency: "weekly",
      priority: 0.6,
    }));

    // Translated pages — one URL per language per prompt that has translation
    const translatedPages: MetadataRoute.Sitemap = prompts.flatMap((prompt) => {
      const translations = prompt.translations as Record<string, { title?: string }> | null;
      if (!translations) return [];
      return TRANSLATED_LANGS
        .filter((lang) => translations[lang]?.title)
        .map((lang) => ({
          url: `${baseUrl}/prompts/${prompt._id.toHexString()}_${prompt.slug}/${lang}`,
          lastModified: prompt.updatedAt,
          changeFrequency: "monthly" as const,
          priority: 0.5,
        }));
    });

    const tagPages: MetadataRoute.Sitemap = tags.map((tag) => ({
      url: `${baseUrl}/tags/${tag.slug}`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.5,
    }));

    return [...staticPages, ...bookPages, ...categoryPages, ...promptPages, ...translatedPages, ...tagPages];
  } catch {
    // Database unavailable (build time) - return static and book pages only
    return [...staticPages, ...bookPages];
  }
}
