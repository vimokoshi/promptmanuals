import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import type { PromptDocument, UserDocument, CategoryDocument } from "@/lib/mongodb";

export function docId(doc: { _id: unknown }): string {
  return (doc._id as unknown as { toString(): string }).toString();
}

export function formatTags(tags: PromptDocument["tags"]) {
  return tags.map((t) => ({
    tag: {
      id: t._id as unknown as string,
      name: t.name,
      slug: t.slug,
      color: t.color,
    },
  }));
}

export function formatAuthor(user: UserDocument) {
  return {
    id: docId(user),
    name: user.name,
    username: user.username,
    avatar: user.avatar,
    verified: user.verified,
  };
}

export function formatCategory(
  cat: CategoryDocument | null,
  parent: CategoryDocument | null
) {
  if (!cat) return null;
  return {
    id: docId(cat),
    name: cat.name,
    slug: cat.slug,
    parent: parent
      ? { id: docId(parent), name: parent.name, slug: parent.slug }
      : null,
  };
}

export interface PromptForCard {
  id: string;
  slug: string | null;
  title: string;
  description: string | null;
  content: string;
  type: string;
  structuredFormat: string | null;
  mediaUrl: string | null;
  isPrivate: boolean;
  voteCount: number;
  createdAt: Date;
  author: {
    id: string;
    name: string | null;
    username: string;
    avatar: string | null;
    verified?: boolean;
  };
  category: {
    id: string;
    name: string;
    slug: string;
    parent?: { id: string; name: string; slug: string } | null;
  } | null;
  tags: Array<{ tag: { id: string; name: string; slug: string; color: string } }>;
  userExamples?: Array<{
    id: string;
    mediaUrl: string;
    user: { username: string; name: string | null; avatar: string | null };
  }>;
  contributorCount?: number;
  contributors?: Array<{
    id: string;
    username: string;
    name: string | null;
    avatar: string | null;
  }>;
}

export async function formatPromptsForCard(
  docs: PromptDocument[]
): Promise<PromptForCard[]> {
  if (docs.length === 0) return [];

  const authorIds = [...new Set(docs.map((d) => d.authorId))];
  const categoryIds = [
    ...new Set(docs.map((d) => d.categoryId).filter(Boolean)),
  ] as string[];

  const [authors, categories] = await Promise.all([
    usersCol()
      .find({ _id: { $in: authorIds } } as Record<string, unknown>)
      .toArray(),
    categoryIds.length > 0
      ? categoriesCol()
          .find({ _id: { $in: categoryIds } } as Record<string, unknown>)
          .toArray()
      : Promise.resolve([]),
  ]);

  const authorMap = new Map(authors.map((u) => [docId(u), u]));
  const categoryMap = new Map(categories.map((c) => [docId(c), c]));

  const parentIds = [
    ...new Set(categories.map((c) => c.parentId).filter(Boolean)),
  ] as string[];
  const parents =
    parentIds.length > 0
      ? await categoriesCol()
          .find({ _id: { $in: parentIds } } as Record<string, unknown>)
          .toArray()
      : [];
  const parentMap = new Map(parents.map((c) => [docId(c), c]));

  const exampleUserIds = [
    ...new Set(docs.flatMap((d) => d.userExamples?.map((e) => e.userId) ?? [])),
  ];
  const exampleUsers =
    exampleUserIds.length > 0
      ? await usersCol()
          .find({ _id: { $in: exampleUserIds } } as Record<string, unknown>)
          .toArray()
      : [];
  const exampleUserMap = new Map(exampleUsers.map((u) => [docId(u), u]));

  return docs.map((doc) => {
    const id = docId(doc);
    const author = authorMap.get(doc.authorId);
    const category = doc.categoryId
      ? (categoryMap.get(doc.categoryId) ?? null)
      : null;
    const parent = category?.parentId
      ? (parentMap.get(category.parentId) ?? null)
      : null;

    return {
      id,
      slug: doc.slug,
      title: doc.title,
      description: doc.description,
      content: doc.content,
      type: doc.type,
      structuredFormat: doc.structuredFormat,
      mediaUrl: doc.mediaUrl,
      isPrivate: doc.isPrivate,
      voteCount: doc.voteCount,
      createdAt: doc.createdAt,
      author: author
        ? formatAuthor(author)
        : {
            id: doc.authorId,
            name: null,
            username: doc.authorId,
            avatar: null,
            verified: false,
          },
      category: formatCategory(category, parent),
      tags: formatTags(doc.tags),
      userExamples:
        doc.userExamples?.slice(0, 5).map((e) => {
          const u = exampleUserMap.get(e.userId);
          return {
            id: e._id,
            mediaUrl: e.mediaUrl,
            user: u
              ? { username: u.username, name: u.name, avatar: u.avatar }
              : { username: e.userId, name: null, avatar: null },
          };
        }) ?? [],
      contributorCount: 0,
      contributors: [],
    };
  });
}
