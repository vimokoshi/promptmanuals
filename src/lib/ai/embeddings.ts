import OpenAI from "openai";
import { promptsCol, promptConnectionsCol, toObjectId } from "@/lib/mongodb";
import { getConfig } from "@/lib/config";
import { loadPrompt, getSystemPrompt } from "./load-prompt";

const queryTranslatorPrompt = loadPrompt("src/lib/ai/query-translator.prompt.yml");

let openai: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    openai = new OpenAI({
      apiKey,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return openai;
}

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
const TRANSLATION_MODEL = process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini";

/**
 * Translate a non-English search query to English keywords for better semantic search.
 * Uses a cheap model to extract and translate keywords.
 */
export async function translateQueryToEnglish(query: string): Promise<string> {
  const client = getOpenAIClient();

  try {
    const response = await client.chat.completions.create({
      model: TRANSLATION_MODEL,
      messages: [
        {
          role: "system",
          content: getSystemPrompt(queryTranslatorPrompt),
        },
        {
          role: "user",
          content: query,
        },
      ],
      max_tokens: queryTranslatorPrompt.modelParameters?.maxTokens || 100,
      temperature: queryTranslatorPrompt.modelParameters?.temperature || 0,
    });

    const translatedQuery = response.choices[0]?.message?.content?.trim();
    return translatedQuery || query;
  } catch (error) {
    console.error("Query translation failed:", error);
    return query;
  }
}

/**
 * Check if a string contains non-ASCII characters (likely non-English)
 */
function containsNonEnglish(text: string): boolean {
  return /[^\x00-\x7F]/.test(text);
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient();

  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

export async function generatePromptEmbedding(promptId: string): Promise<void> {
  const config = await getConfig();
  if (!config.features.aiSearch) return;

  const _id = toObjectId(promptId);
  if (!_id) return;

  const prompt = await promptsCol().findOne(
    { _id },
    { projection: { title: 1, description: 1, content: 1, isPrivate: 1 } }
  );

  if (!prompt) return;

  // Never generate embeddings for private prompts
  if (prompt.isPrivate) return;

  const textToEmbed = [
    prompt.title,
    prompt.description || "",
    prompt.content,
  ]
    .join("\n\n")
    .trim();

  const embedding = await generateEmbedding(textToEmbed);

  await promptsCol().updateOne(
    { _id },
    { $set: { embedding, updatedAt: new Date() } }
  );
}

// Delay helper to avoid rate limits
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateAllEmbeddings(
  onProgress?: (current: number, total: number, success: number, failed: number) => void,
  regenerate: boolean = false
): Promise<{ success: number; failed: number; total: number }> {
  const config = await getConfig();
  if (!config.features.aiSearch) {
    throw new Error("AI Search is not enabled");
  }

  const filter = {
    ...(regenerate ? {} : { embedding: null }),
    isPrivate: false,
    deletedAt: null,
  };

  const prompts = await promptsCol()
    .find(filter)
    .project({ _id: 1 })
    .toArray();

  const total = prompts.length;
  let success = 0;
  let failed = 0;

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    try {
      await generatePromptEmbedding(prompt._id.toHexString());
      success++;
    } catch {
      failed++;
    }

    if (onProgress) {
      onProgress(i + 1, total, success, failed);
    }

    // Rate limit: wait 1000ms between requests to avoid hitting API limits
    if (i < prompts.length - 1) {
      await delay(1000);
    }
  }

  return { success, failed, total };
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SemanticSearchResult {
  id: string;
  title: string;
  description: string | null;
  content: string;
  similarity: number;
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
  } | null;
  tags: Array<{
    tag: {
      id: string;
      name: string;
      slug: string;
      color: string;
    };
  }>;
  voteCount: number;
  type: string;
  structuredFormat: string | null;
  mediaUrl: string | null;
  isPrivate: boolean;
  createdAt: Date;
}

export async function semanticSearch(
  query: string,
  limit: number = 20
): Promise<SemanticSearchResult[]> {
  const config = await getConfig();
  if (!config.features.aiSearch) {
    throw new Error("AI Search is not enabled");
  }

  // Translate non-English queries to English for better semantic matching
  let searchQuery = query;
  if (containsNonEnglish(query)) {
    searchQuery = await translateQueryToEnglish(query);
  }

  const queryEmbedding = await generateEmbedding(searchQuery);

  // Fetch all public prompts with embeddings (excluding soft-deleted)
  const prompts = await promptsCol()
    .find({
      isPrivate: false,
      deletedAt: null,
      embedding: { $ne: null },
    })
    .toArray();

  const SIMILARITY_THRESHOLD = 0.4;

  const scoredPrompts = prompts
    .map((prompt) => {
      const embedding = prompt.embedding as number[];
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return { prompt, similarity };
    })
    .filter(({ similarity }) => similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return scoredPrompts.map(({ prompt, similarity }) => ({
    id: prompt._id.toHexString(),
    title: prompt.title,
    description: prompt.description ?? null,
    content: prompt.content,
    similarity,
    // TODO: author name/username/avatar require a separate user lookup (no join in MongoDB).
    // Callers that need full author info should hydrate from the users collection.
    author: {
      id: prompt.authorId,
      name: null,
      username: "",
      avatar: null,
    },
    // TODO: category name/slug require a separate category lookup.
    category: prompt.categoryId
      ? { id: prompt.categoryId, name: "", slug: "" }
      : null,
    tags: (prompt.tags ?? []).map((t) => ({
      tag: {
        id: t._id,
        name: t.name,
        slug: t.slug,
        color: t.color,
      },
    })),
    voteCount: prompt.voteCount ?? 0,
    type: prompt.type,
    structuredFormat: prompt.structuredFormat ?? null,
    mediaUrl: prompt.mediaUrl ?? null,
    isPrivate: prompt.isPrivate,
    createdAt: prompt.createdAt,
  }));
}

export async function isAISearchEnabled(): Promise<boolean> {
  const config = await getConfig();
  return config.features.aiSearch === true && !!process.env.OPENAI_API_KEY;
}

/**
 * Find and save 4 related prompts based on embedding similarity.
 * Uses PromptConnection with label "related" to store relationships.
 */
export async function findAndSaveRelatedPrompts(promptId: string): Promise<void> {
  const config = await getConfig();
  if (!config.features.aiSearch) return;

  const _id = toObjectId(promptId);
  if (!_id) return;

  const prompt = await promptsCol().findOne(
    { _id },
    { projection: { embedding: 1, isPrivate: 1, authorId: 1, type: 1 } }
  );

  if (!prompt || !prompt.embedding || prompt.isPrivate) return;

  const promptEmbedding = prompt.embedding as number[];

  // Fetch all public, non-unlisted prompts with embeddings of the same type
  // (excluding this prompt and soft-deleted ones)
  const candidates = await promptsCol()
    .find({
      _id: { $ne: _id },
      isPrivate: false,
      isUnlisted: false,
      deletedAt: null,
      embedding: { $ne: null },
      type: prompt.type,
    })
    .project({ _id: 1, embedding: 1 })
    .toArray();

  const SIMILARITY_THRESHOLD = 0.5;

  const scoredPrompts = candidates
    .map((p): { id: string; similarity: number } => ({
      id: (p._id as import("mongodb").ObjectId).toHexString(),
      similarity: cosineSimilarity(promptEmbedding, p.embedding as number[]),
    }))
    .filter((p) => p.similarity >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 4);

  if (scoredPrompts.length === 0) return;

  // Delete existing related connections for this prompt
  await promptConnectionsCol().deleteMany({ sourceId: promptId, label: "related" });

  // Create new related connections
  const now = new Date();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (promptConnectionsCol() as any).insertMany(
    scoredPrompts.map((p, index) => ({
      sourceId: promptId,
      targetId: p.id,
      label: "related",
      order: index,
      createdAt: now,
      updatedAt: now,
    }))
  );
}
