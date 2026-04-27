import { NextResponse } from "next/server";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { UserDocument } from "@/lib/mongodb";

function escapeCSVField(field: string): string {
  if (!field) return "";

  const needsQuoting = /[,"\n\r]/.test(field) || field !== field.trim();

  if (needsQuoting) {
    const escaped = field.replace(/"/g, '""');
    return `"${escaped}"`;
  }

  return field;
}

function getUserIdentifier(user: {
  email: string;
  username: string;
  githubUsername: string | null;
}): string {
  // Determine contributor identifier (immutable to prevent impersonation):
  // 1. githubUsername if set (GitHub OAuth users)
  // 2. username if email ends with @unclaimed.prompts.chat (imported GitHub contributors)
  // 3. email for others (Google, credentials)
  const isUnclaimedAccount = user.email.endsWith("@unclaimed.prompts.chat");
  return user.githubUsername || (isUnclaimedAccount ? user.username : user.email);
}

export const revalidate = 3600;

export async function GET() {
  try {
    const docs = await promptsCol()
      .find({ isPrivate: false, isUnlisted: false, deletedAt: null })
      .sort({ createdAt: 1 })
      .project({
        _id: 1,
        title: 1,
        content: 1,
        structuredFormat: 1,
        authorId: 1,
        categoryId: 1,
      })
      .toArray();

    if (docs.length === 0) {
      const csvContent = "act,prompt,for_devs,type,contributor\n";
      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Batch-fetch authors
    const authorIds = [...new Set(docs.map(d => d.authorId as string))];
    const authorDocs = await usersCol()
      .find({ _id: { $in: authorIds } } as Record<string, unknown>)
      .project({ _id: 1, email: 1, username: 1, githubUsername: 1 })
      .toArray();
    const authorMap = new Map<string, UserDocument>(
      authorDocs.map(u => [(u._id as ObjectId).toHexString(), u as unknown as UserDocument])
    );

    // Batch-fetch categories to check for "coding" slug
    const categoryIds = [
      ...new Set(docs.map(d => d.categoryId as string | null).filter(Boolean)),
    ] as string[];
    const categoryDocs = categoryIds.length > 0
      ? await categoriesCol()
          .find({ _id: { $in: categoryIds } } as Record<string, unknown>)
          .project({ _id: 1, slug: 1 })
          .toArray()
      : [];
    const categorySlugMap = new Map<string, string>(
      categoryDocs.map(c => [(c._id as ObjectId).toHexString(), c.slug as string])
    );

    const headers = ["act", "prompt", "for_devs", "type", "contributor"];
    const rows = docs.map(doc => {
      const act = escapeCSVField(doc.title as string);
      const promptContent = escapeCSVField(doc.content as string);
      const categorySlug = doc.categoryId
        ? categorySlugMap.get(doc.categoryId as string) ?? null
        : null;
      const forDevs = categorySlug === "coding" ? "TRUE" : "FALSE";
      const structuredFormat = doc.structuredFormat as string | null;
      const type =
        structuredFormat === "JSON" || structuredFormat === "YAML"
          ? "STRUCTURED"
          : "TEXT";

      const author = authorMap.get(doc.authorId as string);
      const contributorField = author
        ? escapeCSVField(getUserIdentifier(author as unknown as { email: string; username: string; githubUsername: string | null }))
        : "";

      return [act, promptContent, forDevs, type, contributorField].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    console.error("prompts.csv error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
