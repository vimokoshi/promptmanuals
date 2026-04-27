import { NextRequest, NextResponse } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ElicitResultSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  type PrimitiveSchemaDefinition,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { promptsCol, usersCol, categoriesCol, tagsCol } from "@/lib/mongodb";
import type { EmbeddedTag } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { docId } from "@/lib/mongodb/prompt-helpers";
import { isValidApiKeyFormat } from "@/lib/api-key";
import { parseSkillFiles, serializeSkillFiles, DEFAULT_SKILL_FILE } from "@/lib/skill-files";
import appConfig from "@/../prompts.config";

interface AuthenticatedUser {
  id: string;
  username: string;
  mcpPromptsPublicByDefault: boolean;
}

async function authenticateApiKey(apiKey: string | null): Promise<AuthenticatedUser | null> {
  if (!apiKey || !isValidApiKeyFormat(apiKey)) return null;
  const user = await usersCol().findOne(
    { apiKey },
    { projection: { _id: 1, username: 1, mcpPromptsPublicByDefault: 1 } }
  );
  if (!user) return null;
  return { id: docId(user), username: user.username, mcpPromptsPublicByDefault: user.mcpPromptsPublicByDefault ?? false };
}

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}

function getPromptName(prompt: { id: string; slug?: string | null; title: string }): string {
  if (prompt.slug) return prompt.slug;
  const titleSlug = slugify(prompt.title);
  return titleSlug || prompt.id;
}

interface ExtractedVariable { name: string; defaultValue?: string; }

function extractVariables(content: string): ExtractedVariable[] {
  const vars: ExtractedVariable[] = [];
  const regex = /\$\{([^}:]+)(?::([^}]*))?\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (!vars.find((v) => v.name === match![1])) {
      vars.push({ name: match![1], defaultValue: match[2] });
    }
  }
  return vars;
}

// Re-export types from the pages router source
type ServerOptions = {
  authenticatedUser: AuthenticatedUser | null;
  categories?: string[];
  tags?: string[];
  users?: string[];
};

function createServer(options: ServerOptions): InstanceType<typeof McpServer> {
  const server = new McpServer({ name: "prompts-chat", version: "1.0.0" });

  server.registerTool(
    "search_prompts",
    {
      title: "Search Prompts",
      description: "Search for prompts by query string. Returns matching prompts with metadata.",
      inputSchema: {
        query: z.string().describe("Search query string"),
        category: z.string().optional().describe("Filter by category slug"),
        limit: z.number().optional().default(10).describe("Maximum results"),
        page: z.number().optional().default(1).describe("Page number"),
      },
    },
    async ({ query, category, limit = 10, page = 1 }) => {
      try {
        const filter: Record<string, unknown> = {
          isPrivate: false,
          isUnlisted: false,
          deletedAt: null,
        };

        // Category filter
        if (options.categories?.length) {
          const cats = await categoriesCol().find({ slug: { $in: options.categories } }).toArray();
          const catIds = cats.map((c) => docId(c));
          if (catIds.length > 0) filter.categoryId = { $in: catIds };
        } else if (category) {
          const cat = await categoriesCol().findOne({ slug: category });
          if (cat) filter.categoryId = docId(cat);
        }

        // Tags filter (embedded)
        if (options.tags?.length) {
          filter["tags.slug"] = { $in: options.tags };
        }

        // Users filter
        if (options.users?.length) {
          const userDocs = await usersCol()
            .find({ username: { $in: options.users } })
            .project({ _id: 1 })
            .toArray();
          const userIds = userDocs.map((u) => docId(u));
          filter.authorId = { $in: userIds };
        }

        // Text search
        if (query) {
          filter.$or = [
            { title: { $regex: query, $options: "i" } },
            { content: { $regex: query, $options: "i" } },
          ];
        }

        const prompts = await promptsCol()
          .find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();

        if (prompts.length === 0) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ query, count: 0, results: [] }) }] };
        }

        // Batch fetch authors
        const authorIds = [...new Set(prompts.map((p) => p.authorId))];
        const authors = await usersCol()
          .find({ _id: { $in: authorIds } } as Record<string, unknown>)
          .toArray();
        const authorMap = new Map(authors.map((u) => [docId(u), u]));

        // Batch fetch categories
        const categoryIds = [...new Set(prompts.map((p) => p.categoryId).filter(Boolean))] as string[];
        const categories = categoryIds.length > 0
          ? await categoriesCol()
              .find({ _id: { $in: categoryIds } } as Record<string, unknown>)
              .toArray()
          : [];
        const categoryMap = new Map(categories.map((c) => [docId(c), c]));

        const results = prompts.map((p) => {
          const id = p._id.toHexString();
          const variables = extractVariables(p.content ?? "");
          const author = authorMap.get(p.authorId);
          const cat = p.categoryId ? categoryMap.get(p.categoryId) ?? null : null;
          return {
            id,
            title: p.title,
            slug: p.slug,
            description: p.description,
            content: p.content,
            type: p.type,
            viewCount: p.viewCount,
            voteCount: p.voteCount,
            commentCount: 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            category: cat ? { id: docId(cat), name: cat.name, slug: cat.slug, icon: (cat as Record<string, unknown>).icon ?? null } : null,
            author: author
              ? { username: author.username, name: author.name, avatar: author.avatar, verified: author.verified }
              : { username: p.authorId, name: null, avatar: null, verified: false },
            tags: p.tags.map((t) => ({ id: t._id, name: t.name, slug: t.slug, color: t.color })),
            hasVariables: variables.length > 0,
            variables,
            link: `https://prompts.chat/prompts/${id}_${getPromptName({ id, slug: p.slug, title: p.title })}`,
          };
        });

        return { content: [{ type: "text" as const, text: JSON.stringify({ query, count: results.length, results }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Search failed" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_prompt",
    {
      title: "Get Prompt",
      description: "Get a single prompt by ID. Optionally fill template variables or get full content.",
      inputSchema: {
        promptId: z.string().describe("Prompt ID"),
        fillVariables: z.boolean().optional().default(false).describe("Whether to fill template variables"),
        variables: z.record(z.string(), z.string()).optional().describe("Variables to fill"),
      },
    },
    async ({ promptId, fillVariables = false, variables = {} }) => {
      try {
        let oid: ObjectId;
        try {
          oid = new ObjectId(promptId);
        } catch {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }], isError: true };
        }

        const prompt = await promptsCol().findOne({ _id: oid });

        if (!prompt || prompt.isPrivate || prompt.isUnlisted) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }], isError: true };
        }

        // Increment view count
        await promptsCol().updateOne({ _id: oid }, { $inc: { viewCount: 1 } } as any);

        // Author lookup
        const author = await usersCol().findOne(
          { _id: new ObjectId(prompt.authorId) } as Record<string, unknown>,
          { projection: { username: 1, name: 1, avatar: 1, verified: 1 } }
        );

        // Category lookup
        const category = prompt.categoryId
          ? await categoriesCol().findOne({ _id: new ObjectId(prompt.categoryId) } as Record<string, unknown>)
          : null;

        const id = prompt._id.toHexString();
        const variables_list = extractVariables(prompt.content ?? "");

        let content = prompt.content ?? "";
        if (fillVariables && variables && Object.keys(variables).length > 0) {
          for (const [key, value] of Object.entries(variables)) {
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
              content = content.replace(new RegExp(`\\$\\{${key}(?::[^}]*)?\\}`, "g"), String(value));
            }
          }
        }

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id,
              title: prompt.title,
              slug: prompt.slug,
              description: prompt.description,
              content,
              type: prompt.type,
              mediaUrl: prompt.mediaUrl,
              viewCount: prompt.viewCount,
              createdAt: prompt.createdAt,
              updatedAt: prompt.updatedAt,
              structuredFormat: prompt.structuredFormat,
              requiresMediaUpload: prompt.requiresMediaUpload,
              requiredMediaType: prompt.requiredMediaType,
              variables: variables_list,
              author: author ? (author.name || author.username) : prompt.authorId,
              category: category ? category.name : null,
              tags: prompt.tags.map((t) => t.name),
              link: `https://prompts.chat/prompts/${id}_${getPromptName({ id, slug: prompt.slug, title: prompt.title })}`,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get prompt" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "save_prompt",
    {
      title: "Save Prompt",
      description: "Create a new prompt. Requires API key authentication.",
      inputSchema: {
        title: z.string().describe("Prompt title"),
        content: z.string().describe("Prompt content"),
        description: z.string().optional().describe("Prompt description"),
        isPrivate: z.boolean().optional().default(false).describe("Whether prompt is private"),
        category: z.string().optional().describe("Category slug"),
        tags: z.array(z.string()).optional().describe("Tag slugs"),
      },
    },
    async ({ title, content, description, isPrivate = false, category, tags }) => {
      if (!options.authenticatedUser) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required" }) }], isError: true };
      }
      try {
        // Category lookup
        let categoryId: string | null = null;
        if (category) {
          const cat = await categoriesCol().findOne({ slug: category });
          if (cat) categoryId = docId(cat);
        }

        // Tag resolution (find or create)
        const embeddedTags: EmbeddedTag[] = [];
        if (tags?.length) {
          for (const tagSlug of tags) {
            let tag = await tagsCol().findOne({ slug: tagSlug });
            if (!tag) {
              const newTag = {
                _id: new ObjectId(),
                name: tagSlug,
                slug: tagSlug,
                color: "#6b7280",
                createdAt: new Date(),
              };
              await tagsCol().insertOne(newTag as any);
              tag = newTag as any;
            }
            embeddedTags.push({ _id: docId(tag!), name: tag!.name, slug: tag!.slug, color: tag!.color });
          }
        }

        // Insert prompt
        const newId = new ObjectId();
        const now = new Date();
        await promptsCol().insertOne({
          _id: newId,
          title,
          slug: slugify(title),
          content,
          description: description || null,
          isPrivate,
          type: "TEXT",
          structuredFormat: null,
          authorId: options.authenticatedUser!.id,
          categoryId,
          tags: embeddedTags,
          votes: [],
          voteCount: 0,
          versions: [],
          userExamples: [],
          reports: [],
          isUnlisted: false,
          unlistedAt: null,
          delistReason: null,
          deletedAt: null,
          mediaUrl: null,
          requiresMediaUpload: false,
          requiredMediaType: null,
          requiredMediaCount: null,
          bestWithModels: [],
          bestWithMCP: null,
          workflowLink: null,
          embedding: null,
          contributors: [],
          flagged: false,
          flaggedAt: null,
          flaggedBy: null,
          isFeatured: false,
          featuredAt: null,
          viewCount: 0,
          createdAt: now,
          updatedAt: now,
          translations: [],
        } as any);

        const promptId = newId.toHexString();
        const prompt = { id: promptId, slug: slugify(title), title, isPrivate, createdAt: now };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              prompt,
              link: `https://prompts.chat/prompts/${promptId}_${getPromptName(prompt)}`,
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to save prompt" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "improve_prompt",
    {
      title: "Improve Prompt",
      description: "Improve a prompt using AI. Requires API key authentication.",
      inputSchema: {
        content: z.string().describe("The current prompt content to improve"),
        goal: z.string().optional().describe("The improvement goal or purpose"),
      },
    },
    async ({ content, goal }) => {
      if (!options.authenticatedUser) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required" }) }], isError: true };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            original: content,
            improved: content,
            note: "AI improvement requires OpenAI API integration. Set GOOGLECLOUD_PROJECT and OPENAI_API_KEY environment variables.",
            goal: goal || "General improvement",
          }),
        }],
      };
    }
  );

  server.registerTool(
    "save_skill",
    {
      title: "Save Agent Skill",
      description: "Create a new Agent Skill. Requires API key authentication.",
      inputSchema: {
        title: z.string().describe("Skill title"),
        content: z.string().optional().describe("Main skill file content"),
        description: z.string().optional().describe("Skill description"),
        isPrivate: z.boolean().optional().default(false).describe("Whether skill is private"),
        category: z.string().optional().describe("Category slug"),
        tags: z.array(z.string()).optional().describe("Tag slugs"),
      },
    },
    async ({ title, content, description, isPrivate = false, category, tags }) => {
      if (!options.authenticatedUser) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Authentication required" }) }], isError: true };
      }
      try {
        // Category lookup
        let categoryId: string | null = null;
        if (category) {
          const cat = await categoriesCol().findOne({ slug: category });
          if (cat) categoryId = docId(cat);
        }

        const files = content ? [{ filename: DEFAULT_SKILL_FILE, content }] : [];

        // Tag resolution (find or create)
        const embeddedTags: EmbeddedTag[] = [];
        if (tags?.length) {
          for (const tagSlug of tags) {
            let tag = await tagsCol().findOne({ slug: tagSlug });
            if (!tag) {
              const newTag = {
                _id: new ObjectId(),
                name: tagSlug,
                slug: tagSlug,
                color: "#6b7280",
                createdAt: new Date(),
              };
              await tagsCol().insertOne(newTag as any);
              tag = newTag as any;
            }
            embeddedTags.push({ _id: docId(tag!), name: tag!.name, slug: tag!.slug, color: tag!.color });
          }
        }

        // Insert skill
        const newId = new ObjectId();
        const now = new Date();
        await promptsCol().insertOne({
          _id: newId,
          title,
          slug: slugify(title),
          content: content ?? null,
          description: description || null,
          isPrivate,
          type: "SKILL",
          structuredFormat: null,
          authorId: options.authenticatedUser!.id,
          categoryId,
          tags: embeddedTags,
          votes: [],
          voteCount: 0,
          versions: [],
          userExamples: [],
          reports: [],
          isUnlisted: false,
          unlistedAt: null,
          delistReason: null,
          deletedAt: null,
          mediaUrl: null,
          requiresMediaUpload: false,
          requiredMediaType: null,
          requiredMediaCount: null,
          bestWithModels: [],
          bestWithMCP: null,
          workflowLink: null,
          embedding: null,
          contributors: [],
          flagged: false,
          flaggedAt: null,
          flaggedBy: null,
          isFeatured: false,
          featuredAt: null,
          viewCount: 0,
          createdAt: now,
          updatedAt: now,
          translations: [],
        } as any);

        const skillId = newId.toHexString();
        const skill = { id: skillId, slug: slugify(title), title, description: description ?? null, isPrivate, createdAt: now };

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              skill: {
                ...skill,
                files: files.map((f) => f.filename),
                link: skill.isPrivate ? null : `https://prompts.chat/prompts/${skillId}_${getPromptName(skill)}`,
              },
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to save skill" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "get_skill",
    {
      title: "Get Agent Skill",
      description: "Get an existing Agent Skill by ID.",
      inputSchema: { skillId: z.string().describe("Skill ID") },
    },
    async ({ skillId }) => {
      try {
        let oid: ObjectId;
        try {
          oid = new ObjectId(skillId);
        } catch {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }], isError: true };
        }

        const skill = await promptsCol().findOne({ _id: oid });

        if (!skill || skill.isPrivate) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }], isError: true };
        }

        // Author lookup
        const author = await usersCol().findOne(
          { _id: new ObjectId(skill.authorId) } as Record<string, unknown>,
          { projection: { username: 1, name: 1 } }
        );

        // Category lookup
        const category = skill.categoryId
          ? await categoriesCol().findOne({ _id: new ObjectId(skill.categoryId) } as Record<string, unknown>)
          : null;

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: skill._id.toHexString(),
              title: skill.title,
              slug: skill.slug,
              description: skill.description,
              content: skill.content,
              isPrivate: skill.isPrivate,
              category: category ? category.name : null,
              author: author ? { username: author.username, name: author.name } : { username: skill.authorId, name: null },
              tags: skill.tags.map((t) => t.name),
              files: [DEFAULT_SKILL_FILE],
            }),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Failed to get skill" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "search_skills",
    {
      title: "Search Agent Skills",
      description: "Search for Agent Skills by query.",
      inputSchema: {
        query: z.string().describe("Search query"),
        limit: z.number().optional().default(10).describe("Maximum results"),
      },
    },
    async ({ query, limit = 10 }) => {
      try {
        const skills = await promptsCol()
          .find({ type: "SKILL", isPrivate: false, isUnlisted: false, deletedAt: null })
          .sort({ createdAt: -1 })
          .limit(limit)
          .toArray();

        const results = skills.map((s) => ({
          id: s._id.toHexString(),
          title: s.title,
          description: s.description,
          slug: s.slug,
          createdAt: s.createdAt,
        }));

        return { content: [{ type: "text" as const, text: JSON.stringify({ query, count: results.length, results }) }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Search failed" }) }], isError: true };
      }
    }
  );

  server.registerTool(
    "list_prompt_tools",
    {
      title: "List Prompt Tools",
      description: "Returns all available MCP tools with their descriptions and input schemas.",
      inputSchema: {},
    },
    async () => {
      return { content: [{ type: "text" as const, text: JSON.stringify({ tools: ["search_prompts", "get_prompt", "save_prompt", "improve_prompt", "save_skill", "get_skill", "search_skills", "list_prompt_tools"] }) }] };
    }
  );

  return server;
}

async function parseBody(req: Request): Promise<unknown> {
  const MAX_BODY_SIZE = 1024 * 1024;
  let bytesReceived = 0;
  const chunks: Uint8Array[] = [];
  const reader = (req as unknown as { body?: ReadableStream<Uint8Array> }).body?.getReader();
  if (!reader) return {};
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesReceived += value.length;
      if (bytesReceived > MAX_BODY_SIZE) throw new Error("Body too large");
      chunks.push(value);
    }
    const body = Buffer.concat(chunks).toString();
    try { return JSON.parse(body); } catch { return {}; }
  } finally {
    reader.releaseLock();
  }
}

export async function GET(req: NextRequest) {
  if (!appConfig.features.mcp) {
    return NextResponse.json({ error: "MCP is not enabled" }, { status: 404 });
  }
  try {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer({ authenticatedUser: null });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    return new NextResponse(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("MCP GET error:", error);
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" } }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!appConfig.features.mcp) {
    return NextResponse.json({ error: "MCP is not enabled" }, { status: 404 });
  }
  try {
    const apiKeyHeader = req.headers.get("x-api-key") || req.headers.get("prompts_api_key");
    const apiKeyParam = req.nextUrl.searchParams.get("api_key");
    const apiKey = apiKeyHeader || apiKeyParam;
    const authenticatedUser = await authenticateApiKey(apiKey);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer({ authenticatedUser });
    await server.connect(transport);
    const response = await transport.handleRequest(req);
    return new NextResponse(response.body, { status: response.status, headers: response.headers });
  } catch (error) {
    console.error("MCP POST error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ jsonrpc: "2.0", error: { code: -32603, message } }, { status: 500 });
  }
}

export async function DELETE() {
  if (!appConfig.features.mcp) {
    return NextResponse.json({ error: "MCP is not enabled" }, { status: 404 });
  }
  return new NextResponse(null, { status: 204 });
}
