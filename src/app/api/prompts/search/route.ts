import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q") || "";
  const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50);
  const ownerOnly = searchParams.get("ownerOnly") === "true";

  if (query.length < 2) {
    return NextResponse.json({ prompts: [] });
  }

  const session = await auth();

  try {
    // Handle comma-separated keywords
    const keywords = query.split(",").map(k => k.trim()).filter(Boolean);

    const titleConditions =
      keywords.length > 1
        ? keywords.map(keyword => ({ title: { $regex: keyword, $options: "i" } }))
        : [{ title: { $regex: query, $options: "i" } }];

    // Build visibility filter
    let visibilityFilter: Record<string, unknown>;
    if (ownerOnly && session?.user) {
      visibilityFilter = { authorId: session.user.id };
    } else {
      const orClauses: Record<string, unknown>[] = [{ isPrivate: false }];
      if (session?.user) {
        orClauses.push({ authorId: session.user.id });
      }
      visibilityFilter = { $or: orClauses };
    }

    const filter: Record<string, unknown> = {
      deletedAt: null,
      isUnlisted: false,
      ...visibilityFilter,
      $or: titleConditions,
    };

    const docs = await promptsCol()
      .find(filter)
      .sort({ isFeatured: -1, viewCount: -1 })
      .limit(limit)
      .project({ _id: 1, title: 1, slug: 1, authorId: 1 })
      .toArray();

    const prompts = docs.map(doc => ({
      id: (doc._id as { toHexString(): string }).toHexString(),
      title: doc.title,
      slug: doc.slug,
    }));

    return NextResponse.json({ prompts });
  } catch (error) {
    console.error("Search failed:", error);
    return NextResponse.json(
      { error: "Search failed" },
      { status: 500 }
    );
  }
}
