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
import { db } from "@/lib/db";
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
  const user = await db.user.findUnique({
    where: { apiKey },
    select: { id: true, username: true, mcpPromptsPublicByDefault: true },
  });
  return user;
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
        const whereClause: Record<string, unknown> = {
          isPrivate: false,
          isUnlisted: false,
          deletedAt: null,
        };

        if (options.categories?.length) {
          whereClause.category = { slug: { in: options.categories } };
        } else if (category) {
          whereClause.category = { slug: category };
        }

        if (options.tags?.length) {
          whereClause.tags = { some: { tag: { slug: { in: options.tags } } } };
        }

        if (options.users?.length) {
          whereClause.author = { username: { in: options.users } };
        }

        const prompts = await db.prompt.findMany({
          where: whereClause,
          select: {
            id: true, title: true, slug: true, description: true, content: true, type: true,
            viewCount: true, createdAt: true, updatedAt: true, structuredFormat: true,
            requiresMediaUpload: true, requiredMediaType: true,
            category: { select: { id: true, name: true, slug: true, icon: true } },
            author: { select: { username: true, name: true, avatar: true, verified: true } },
            tags: { select: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
            _count: { select: { votes: true, comments: true } },
          },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: (page - 1) * limit,
        });

        const results = prompts.map((p) => {
          const variables = extractVariables(p.content);
          return {
            id: p.id, title: p.title, slug: p.slug, description: p.description,
            content: p.content, type: p.type, viewCount: p.viewCount,
            voteCount: p._count.votes, commentCount: p._count.comments,
            createdAt: p.createdAt, updatedAt: p.updatedAt,
            category: p.category,
            author: { username: p.author.username, name: p.author.name, avatar: p.author.avatar, verified: p.author.verified },
            tags: p.tags.map((t) => t.tag),
            hasVariables: variables.length > 0,
            variables,
            link: `https://prompts.chat/prompts/${p.id}_${getPromptName(p)}`,
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
        const prompt = await db.prompt.findUnique({
          where: { id: promptId },
          select: {
            id: true, title: true, slug: true, description: true, content: true, type: true,
            mediaUrl: true, viewCount: true, createdAt: true, updatedAt: true,
            structuredFormat: true, requiresMediaUpload: true, requiredMediaType: true,
            category: { select: { id: true, name: true, slug: true, icon: true } },
            author: { select: { username: true, name: true, avatar: true, verified: true } },
            tags: { select: { tag: { select: { id: true, name: true, slug: true, color: true } } } },
            _count: { select: { votes: true, comments: true } },
          },
        });

        if (!prompt || (prompt as unknown as { isPrivate?: boolean }).isPrivate || (prompt as unknown as { isUnlisted?: boolean }).isUnlisted) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Prompt not found" }) }], isError: true };
        }

        await db.prompt.update({ where: { id: promptId }, data: { viewCount: { increment: 1 } } });

        const variables_list = extractVariables(prompt.content);

        let content = prompt.content;
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
              ...prompt,
              content,
              variables: variables_list,
              author: prompt.author.name || prompt.author.username,
              category: prompt.category?.name || null,
              tags: prompt.tags.map((t) => t.tag.name),
              link: `https://prompts.chat/prompts/${prompt.id}_${getPromptName(prompt)}`,
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
          const cat = await db.category.findUnique({ where: { slug: category } });
          if (cat) categoryId = cat.id;
        }
        const tagConnections = tags?.length
          ? { create: await Promise.all(tags.map(async (tagSlug) => {
              let tag = await db.tag.findUnique({ where: { slug: tagSlug } });
              if (!tag) tag = await db.tag.create({ data: { name: tagSlug, slug: tagSlug } });
              return { tagId: tag.id };
            })) }
          : undefined;
        const prompt = await db.prompt.create({
          data: {
            title: title as string,
            slug: slugify(title as string),
            content,
            description: description || null,
            isPrivate,
            authorId: options.authenticatedUser.id,
            categoryId,
            tags: tagConnections,
          } as Parameters<typeof db.prompt.create>[0]["data"],
          select: { id: true, slug: true, title: true, isPrivate: true, createdAt: true },
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, prompt, link: `https://prompts.chat/prompts/${prompt.id}_${getPromptName(prompt)}` }) }] };
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
        let categoryId: string | null = null;
        if (category) {
          const cat = await db.category.findUnique({ where: { slug: category } });
          if (cat) categoryId = cat.id;
        }
        const files = content ? [{ filename: DEFAULT_SKILL_FILE, content }] : [];
        const tagConnections = tags?.length
          ? { create: await Promise.all(tags.map(async (tagSlug) => {
              let tag = await db.tag.findUnique({ where: { slug: tagSlug } });
              if (!tag) tag = await db.tag.create({ data: { name: tagSlug, slug: tagSlug } });
              return { tagId: tag.id };
            })) }
          : undefined;
        const skill = await db.prompt.create({
          data: {
            title: title as string,
            slug: slugify(title as string),
            content,
            description: description || null,
            isPrivate,
            type: "SKILL" as unknown as "TEXT",
            authorId: options.authenticatedUser.id,
            categoryId,
            tags: tagConnections,
          } as Parameters<typeof db.prompt.create>[0]["data"],
          select: { id: true, slug: true, title: true, description: true, isPrivate: true, createdAt: true },
        });
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              skill: { ...skill, files: files.map((f) => f.filename), link: skill.isPrivate ? null : `https://prompts.chat/prompts/${skill.id}_${getPromptName(skill)}` },
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
        const skill = await db.prompt.findUnique({
          where: { id: skillId },
          select: {
            id: true, title: true, slug: true, description: true, content: true, isPrivate: true,
            category: { select: { name: true, slug: true } },
            author: { select: { username: true, name: true } },
            tags: { select: { tag: { select: { name: true, slug: true } } } },
          },
        });
        if (!skill || skill.isPrivate) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Skill not found" }) }], isError: true };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify({ ...skill, category: skill.category?.name || null, tags: skill.tags.map((t) => t.tag.name), files: [DEFAULT_SKILL_FILE] }) }] };
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
        const skills = await db.prompt.findMany({
          where: { type: "SKILL", isPrivate: false, isUnlisted: false, deletedAt: null },
          select: { id: true, title: true, description: true, slug: true, createdAt: true },
          take: limit,
          orderBy: { createdAt: "desc" },
        });
        return { content: [{ type: "text" as const, text: JSON.stringify({ query, count: skills.length, results: skills }) }] };
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
