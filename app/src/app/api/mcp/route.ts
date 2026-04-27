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
import { usersCol, promptsCol, categoriesCol, tagsCol } from "@/lib/mongodb";
import { isValidApiKeyFormat } from "@/lib/api-key";
import { parseSkillFiles, serializeSkillFiles, DEFAULT_SKILL_FILE } from "@/lib/skill-files";
import appConfig from "@/../prompts.config";
import { ObjectId } from "mongodb";

// Suppress unused import warnings for types pulled in from SDK
void ElicitResultSchema;
void ListPromptsRequestSchema;
void GetPromptRequestSchema;
type _PSD = PrimitiveSchemaDefinition;
void (undefined as unknown as _PSD);

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
  return {
    id: user._id.toHexString(),
    username: user.username,
    mcpPromptsPublicByDefault: user.mcpPromptsPublicByDefault ?? false,
  };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filter: Record<string, any> = {
          isPrivate: false,
          isUnlisted: false,
          deletedAt: null,
        };

        // Category filter - look up category by slug
        let categoryId: string | null = null;
        const targetCategorySlug = options.categories?.length ? options.categories[0] : category;
        if (targetCategorySlug) {
          const cat = await categoriesCol().findOne({ slug: targetCategorySlug });
          if (cat) categoryId = cat._id.toHexString();
        }
        if (categoryId) filter.categoryId = categoryId;

        // Tag filter
        if (options.tags?.length) {
          const tagDocs = await tagsCol().find({ slug: { $in: options.tags } }).toArray();
          const tagIds = tagDocs.map((t) => t._id.toHexString());
          if (tagIds.length) filter["tags._id"] = { $in: tagIds };
        }

        // User filter
        if (options.users?.length) {
          const userDocs = await usersCol().find({ username: { $in: options.users } }).toArray();
          const userIds = userDocs.map((u) => u._id.toHexString());
          if (userIds.length) filter.authorId = { $in: userIds };
        }

        // Text search
        if (query) {
          filter.$or = [
            { title: { $regex: query, $options: "i" } },
            { description: { $regex: query, $options: "i" } },
            { content: { $regex: query, $options: "i" } },
          ];
        }

        const skip = (page - 1) * limit;
        const prompts = await promptsCol()
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .toArray();

        // Batch-fetch authors and categories
        const authorIds = [...new Set(prompts.map((p) => p.authorId))];
        const catIds = [...new Set(prompts.map((p) => p.categoryId).filter(Boolean) as string[])];

        const [authors, categories] = await Promise.all([
          usersCol().find({ _id: { $in: authorIds.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) as ObjectId[] } }, { projection: { _id: 1, username: 1, name: 1, avatar: 1, verified: 1 } }).toArray(),
          catIds.length ? categoriesCol().find({ _id: { $in: catIds.map((id) => { try { return new ObjectId(id); } catch { return null; } }).filter(Boolean) as ObjectId[] } }).toArray() : Promise.resolve([]),
        ]);

        const authorMap = new Map(authors.map((u) => [u._id.toHexString(), u]));
        const catMap = new Map(categories.map((c) => [c._id.toHexString(), c]));

        const results = prompts.map((p) => {
          const id = p._id.toHexString();
          const author = authorMap.get(p.authorId);
          const cat = p.categoryId ? catMap.get(p.categoryId) : null;
          const variables = extractVariables(p.content);
          return {
            id,
            title: p.title,
            slug: p.slug,
            description: p.description,
            content: p.content,
            type: p.type,
            viewCount: p.viewCount,
            voteCount: p.voteCount ?? (p.votes?.length ?? 0),
            commentCount: 0,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            category: cat ? { id: cat._id.toHexString(), name: cat.name, slug: cat.slug, icon: cat.icon } : null,
            author: author ? { username: author.username, name: author.name, avatar: author.avatar, verified: author.verified } : null,
            tags: (p.tags ?? []).map((t) => ({ id: t._id, name: t.name, slug: t.slug, color: t.color })),
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
      description: "Get a single prompt by ID.",
      inputSchema: {
        promptId: z.string().describe("Prompt ID"),
        fillVariables: z.boolean().optional().default(false).describe("Whether to fill template variables"),
        variables: z.record(z.string(), z.string()).optional().describe("Variables to fill"),
      },
    },
    async ({ promptId, fillVariables = false, variables = {} }) => {
      try {
        let oid: ObjectId;
        try { oid = new ObjectId(promptId); } catch { return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }], isError: true }; }

        const p = await promptsCol().findOne({ _id: oid });
        if (!p || p.isPrivate || p.isUnlisted) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }], isError: true };
        }

        // Increment view count
        await promptsCol().updateOne({ _id: oid }, { $inc: { viewCount: 1 } });

        const [author, cat] = await Promise.all([
          p.authorId ? usersCol().findOne({ _id: new ObjectId(p.authorId) }, { projection: { username: 1, name: 1, avatar: 1, verified: 1 } }) : null,
          p.categoryId ? categoriesCol().findOne({ _id: new ObjectId(p.categoryId) }) : null,
        ]);

        const variables_list = extractVariables(p.content);
        let content = p.content;
        if (fillVariables && variables && Object.keys(variables).length > 0) {
          for (const [key, value] of Object.entries(variables)) {
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
              content = content.replace(new RegExp(`\\$\\{${key}(?::[^}]*)?\\}`, "g"), String(value));
            }
          }
        }

        const id = p._id.toHexString();
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id,
              title: p.title,
              slug: p.slug,
              description: p.description,
              content,
              type: p.type,
              mediaUrl: p.mediaUrl,
              viewCount: p.viewCount,
              createdAt: p.createdAt,
              updatedAt: p.updatedAt,
              variables: variables_list,
              author: author ? (author.name || author.username) : null,
              category: cat?.name ?? null,
              tags: (p.tags ?? []).map((t) => t.name),
              link: `https://prompts.chat/prompts/${id}_${getPromptName({ id, slug: p.slug, title: p.title })}`,
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
        let categoryId: string | null = null;
        if (category) {
          const cat = await categoriesCol().findOne({ slug: category });
          if (cat) categoryId = cat._id.toHexString();
        }

        // Resolve tag documents, creating if necessary
        const tagDocs = await Promise.all((tags ?? []).map(async (tagSlug) => {
          let tag = await tagsCol().findOne({ slug: tagSlug });
          if (!tag) {
            const oid = new ObjectId();
            await tagsCol().insertOne({ _id: oid, name: tagSlug, slug: tagSlug, color: "#6b7280", createdAt: new Date(), updatedAt: new Date() } as Parameters<ReturnType<typeof tagsCol>["insertOne"]>[0]);
            tag = await tagsCol().findOne({ _id: oid });
          }
          return tag!;
        }));

        const now = new Date();
        const oid = new ObjectId();
        const id = oid.toHexString();
        const slug = slugify(title);

        await promptsCol().insertOne({
          _id: oid,
          title,
          slug,
          content,
          description: description ?? null,
          type: "TEXT",
          isPrivate,
          isUnlisted: false,
          isFeatured: false,
          authorId: options.authenticatedUser.id,
          categoryId,
          tags: tagDocs.map((t) => ({ _id: t._id.toHexString(), name: t.name, slug: t.slug, color: t.color })),
          voteCount: 0,
          votes: [],
          versions: [],
          userExamples: [],
          reports: [],
          viewCount: 0,
          mediaUrl: null,
          embedding: null,
          requiredMediaCount: null,
          requiredMediaType: null,
          requiresMediaUpload: false,
          structuredFormat: null,
          featuredAt: null,
          unlistedAt: null,
          delistReason: null,
          deletedAt: null,
          bestWithModels: [],
          bestWithMCP: null,
          workflowLink: null,
          createdAt: now,
          updatedAt: now,
        } as Parameters<ReturnType<typeof promptsCol>["insertOne"]>[0]);

        const link = isPrivate ? null : `https://prompts.chat/prompts/${id}_${getPromptName({ id, slug, title })}`;
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, prompt: { id, slug, title, isPrivate, createdAt: now }, link }) }] };
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
            note: "AI improvement requires OpenAI API integration.",
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
        let categoryId: string | null = null;
        if (category) {
          const cat = await categoriesCol().findOne({ slug: category });
          if (cat) categoryId = cat._id.toHexString();
        }

        const tagDocs = await Promise.all((tags ?? []).map(async (tagSlug) => {
          let tag = await tagsCol().findOne({ slug: tagSlug });
          if (!tag) {
            const oid = new ObjectId();
            await tagsCol().insertOne({ _id: oid, name: tagSlug, slug: tagSlug, color: "#6b7280", createdAt: new Date(), updatedAt: new Date() } as Parameters<ReturnType<typeof tagsCol>["insertOne"]>[0]);
            tag = await tagsCol().findOne({ _id: oid });
          }
          return tag!;
        }));

        const files = content ? [{ filename: DEFAULT_SKILL_FILE, content }] : [];
        const now = new Date();
        const oid = new ObjectId();
        const id = oid.toHexString();
        const slug = slugify(title);

        await promptsCol().insertOne({
          _id: oid,
          title,
          slug,
          content: content ?? "",
          description: description ?? null,
          type: "SKILL",
          isPrivate,
          isUnlisted: false,
          isFeatured: false,
          authorId: options.authenticatedUser.id,
          categoryId,
          tags: tagDocs.map((t) => ({ _id: t._id.toHexString(), name: t.name, slug: t.slug, color: t.color })),
          voteCount: 0,
          votes: [],
          versions: [],
          userExamples: [],
          reports: [],
          viewCount: 0,
          mediaUrl: null,
          embedding: null,
          requiredMediaCount: null,
          requiredMediaType: null,
          requiresMediaUpload: false,
          structuredFormat: null,
          featuredAt: null,
          unlistedAt: null,
          delistReason: null,
          deletedAt: null,
          bestWithModels: [],
          bestWithMCP: null,
          workflowLink: null,
          createdAt: now,
          updatedAt: now,
        } as Parameters<ReturnType<typeof promptsCol>["insertOne"]>[0]);

        // Serialize skill files if content provided
        if (files.length) {
          await serializeSkillFiles(id, files);
        }

        const link = isPrivate ? null : `https://prompts.chat/prompts/${id}_${getPromptName({ id, slug, title })}`;
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              skill: { id, slug, title, description, isPrivate, files: files.map((f) => f.filename), link, createdAt: now },
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
        try { oid = new ObjectId(skillId); } catch { return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }], isError: true }; }

        const skill = await promptsCol().findOne({ _id: oid, type: "SKILL" });
        if (!skill || skill.isPrivate) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }], isError: true };
        }

        const [author, cat] = await Promise.all([
          skill.authorId ? usersCol().findOne({ _id: new ObjectId(skill.authorId) }, { projection: { username: 1, name: 1 } }) : null,
          skill.categoryId ? categoriesCol().findOne({ _id: new ObjectId(skill.categoryId) }) : null,
        ]);

        const files = await parseSkillFiles(skillId);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              id: skillId,
              title: skill.title,
              slug: skill.slug,
              description: skill.description,
              content: skill.content,
              isPrivate: skill.isPrivate,
              category: cat?.name ?? null,
              author: author ? { username: author.username, name: author.name } : null,
              tags: (skill.tags ?? []).map((t) => t.name),
              files: files.length ? files.map((f) => f.filename) : [DEFAULT_SKILL_FILE],
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const filter: Record<string, any> = { type: "SKILL", isPrivate: false, isUnlisted: false, deletedAt: null };
        if (query) {
          filter.$or = [
            { title: { $regex: query, $options: "i" } },
            { description: { $regex: query, $options: "i" } },
          ];
        }
        const skills = await promptsCol().find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
        const results = skills.map((s) => ({ id: s._id.toHexString(), title: s.title, description: s.description, slug: s.slug, createdAt: s.createdAt }));
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

// Suppress unused variable warning for parseBody (kept for future use)
void parseBody;
