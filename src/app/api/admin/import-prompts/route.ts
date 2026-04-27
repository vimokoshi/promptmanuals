import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol, categoriesCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { PromptDocument, EmbeddedTag } from "@/lib/mongodb";
import fs from "fs/promises";
import path from "path";

interface CsvRow {
  act: string;
  prompt: string;
  for_devs: string;
  type: string;
  contributor: string;
}

// Unescape literal escape sequences like \n, \t, etc.
function unescapeString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function parseCSV(content: string): CsvRow[] {
  const rows: CsvRow[] = [];
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  let isFirstRow = true;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"' && !inQuotes) {
      inQuotes = true;
    } else if (char === '"' && inQuotes) {
      if (nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = false;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = "";
    } else if ((char === '\n' || (char === '\r' && nextChar === '\n')) && !inQuotes) {
      if (char === '\r') i++;
      values.push(current);
      current = "";

      if (isFirstRow) {
        isFirstRow = false;
      } else if (values.some(v => v.trim())) {
        rows.push({
          act: values[0]?.trim() || "",
          prompt: unescapeString(values[1] || ""),
          for_devs: values[2]?.trim() || "",
          type: values[3]?.trim() || "",
          contributor: values[4]?.trim() || "",
        });
      }
      values.length = 0;
    } else {
      current += char;
    }
  }

  if (current || values.length > 0) {
    values.push(current);
    if (!isFirstRow && values.some(v => v.trim())) {
      rows.push({
        act: values[0]?.trim() || "",
        prompt: unescapeString(values[1] || ""),
        for_devs: values[2]?.trim() || "",
        type: values[3]?.trim() || "",
        contributor: values[4]?.trim() || "",
      });
    }
  }

  return rows;
}

function mapCsvTypeToPromptType(csvType: string): {
  type: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "STRUCTURED";
  structuredFormat: "JSON" | "YAML" | null;
} {
  const type = csvType.toUpperCase();
  if (type === "JSON") return { type: "STRUCTURED", structuredFormat: "JSON" };
  if (type === "YAML") return { type: "STRUCTURED", structuredFormat: "YAML" };
  if (type === "IMAGE") return { type: "IMAGE", structuredFormat: null };
  if (type === "VIDEO") return { type: "VIDEO", structuredFormat: null };
  if (type === "AUDIO") return { type: "AUDIO", structuredFormat: null };
  if (type === "STRUCTURED") return { type: "STRUCTURED", structuredFormat: "JSON" };
  return { type: "TEXT", structuredFormat: null };
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const csvPath = path.join(process.cwd(), "prompts.csv");
    const csvContent = await fs.readFile(csvPath, "utf-8");
    const rows = parseCSV(csvContent);

    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid rows found in CSV" }, { status: 400 });
    }

    const adminUserId = session.user.id;

    // Upsert "Coding" category for for_devs prompts
    const codingCategorySlug = "coding";
    let codingCategory = await categoriesCol().findOne({ slug: codingCategorySlug });
    if (!codingCategory) {
      const insertResult = await categoriesCol().insertOne({
        _id: new ObjectId(),
        name: "Coding",
        slug: codingCategorySlug,
        description: "Programming and development prompts",
        icon: "💻",
        order: 0,
        pinned: false,
        parentId: null,
      });
      codingCategory = await categoriesCol().findOne({ _id: insertResult.insertedId });
    }
    const codingCategoryId = codingCategory!._id.toHexString();

    // Cache for contributor users (username -> userId string)
    const contributorCache = new Map<string, string>();

    async function getOrCreateContributorUser(username: string): Promise<string> {
      const normalizedUsername = username.toLowerCase().trim();
      if (contributorCache.has(normalizedUsername)) {
        return contributorCache.get(normalizedUsername)!;
      }

      const pseudoEmail = `${normalizedUsername}@unclaimed.prompts.chat`;

      let user = await usersCol().findOne({
        $or: [{ username: normalizedUsername }, { email: pseudoEmail }],
      });

      if (!user) {
        const now = new Date();
        const insertResult = await usersCol().insertOne({
          _id: new ObjectId(),
          username: normalizedUsername,
          email: pseudoEmail,
          name: normalizedUsername,
          password: null,
          avatar: null,
          bio: null,
          customLinks: null,
          role: "USER",
          locale: "en",
          emailVerified: null,
          createdAt: now,
          updatedAt: now,
          verified: false,
          githubUsername: null,
          apiKey: null,
          mcpPromptsPublicByDefault: false,
          flagged: false,
          flaggedAt: null,
          flaggedReason: null,
          dailyGenerationLimit: 10,
          generationCreditsRemaining: 10,
          generationCreditsResetAt: null,
        });
        const userId = insertResult.insertedId.toHexString();
        contributorCache.set(normalizedUsername, userId);
        return userId;
      }

      const userId = user._id.toHexString();
      contributorCache.set(normalizedUsername, userId);
      return userId;
    }

    async function getOrCreateContributor(contributorField: string): Promise<string> {
      if (!contributorField) return adminUserId;
      const contributors = contributorField.split(',').map(c => c.trim()).filter(Boolean);
      if (contributors.length === 0) return adminUserId;
      for (const username of contributors) {
        await getOrCreateContributorUser(username);
      }
      return contributorCache.get(contributors[0].toLowerCase())!;
    }

    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        const existing = await promptsCol().findOne({ title: row.act }, { projection: { _id: 1 } });
        if (existing) {
          skipped++;
          continue;
        }

        const authorId = await getOrCreateContributor(row.contributor);
        const { type, structuredFormat } = mapCsvTypeToPromptType(row.type);
        const isForDevs = row.for_devs.toUpperCase() === "TRUE";
        const categoryId = isForDevs ? codingCategoryId : null;

        const now = new Date();
        const promptId = new ObjectId();
        const versionId = new ObjectId().toHexString();

        const doc: PromptDocument = {
          _id: promptId,
          title: row.act,
          slug: null,
          description: null,
          content: row.prompt,
          type,
          structuredFormat: structuredFormat ?? null,
          isPrivate: false,
          mediaUrl: null,
          viewCount: 0,
          createdAt: now,
          updatedAt: now,
          authorId,
          categoryId,
          embedding: null,
          requiredMediaCount: null,
          requiredMediaType: null,
          requiresMediaUpload: false,
          featuredAt: null,
          isFeatured: false,
          isUnlisted: false,
          unlistedAt: null,
          delistReason: null,
          deletedAt: null,
          tags: [] as EmbeddedTag[],
          voteCount: 0,
          votes: [],
          versions: [
            {
              _id: versionId,
              version: 1,
              content: row.prompt,
              changeNote: "Imported from prompts.csv",
              createdAt: now,
              createdBy: authorId,
            },
          ],
          userExamples: [],
          reports: [],
          bestWithModels: [],
          bestWithMCP: null,
          workflowLink: null,
          translations: null,
          seoMeta: null,
        };

        await promptsCol().insertOne(doc);
        imported++;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        errors.push(`Failed to import "${row.act}": ${errorMessage}`);
      }
    }

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: rows.length,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    console.error("Error importing prompts:", error);
    return NextResponse.json(
      { error: "Failed to import prompts" },
      { status: 500 }
    );
  }
}

// Delete all community prompts (prompts imported from CSV)
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const csvPath = path.join(process.cwd(), "prompts.csv");
    const csvContent = await fs.readFile(csvPath, "utf-8");
    const rows = parseCSV(csvContent);
    const titles = rows.map(row => row.act);

    const deleteResult = await promptsCol().deleteMany({ title: { $in: titles } });

    const deleteUsersResult = await usersCol().deleteMany({
      email: { $regex: /@unclaimed\.prompts\.chat$/ },
    });

    return NextResponse.json({
      success: true,
      deleted: deleteResult.deletedCount,
      deletedUsers: deleteUsersResult.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting community prompts:", error);
    return NextResponse.json(
      { error: "Failed to delete community prompts" },
      { status: 500 }
    );
  }
}
