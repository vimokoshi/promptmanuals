import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";

const createVersionSchema = z.object({
  content: z.string().min(1, "Content is required"),
  changeNote: z.string().max(500).optional(),
});

// POST - Create a new version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId } = await params;

    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Check if prompt exists and user is owner
    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { authorId: 1, content: 1, versions: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (prompt.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "forbidden", message: "You can only add versions to your own prompts" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = createVersionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { content, changeNote } = parsed.data;

    // Check if content is different
    if (content === prompt.content) {
      return NextResponse.json(
        { error: "no_change", message: "Content is the same as current version" },
        { status: 400 }
      );
    }

    // Get latest version number from embedded array
    const versions = prompt.versions ?? [];
    const latestVersionNum = versions.reduce(
      (max, v) => Math.max(max, v.version),
      0
    );
    const newVersionNumber = latestVersionNum + 1;

    const newVersion = {
      _id: randomUUID(),
      version: newVersionNumber,
      content,
      changeNote: changeNote ?? `Version ${newVersionNumber}`,
      createdAt: new Date(),
      createdBy: session.user.id,
    };

    // Push new version and update prompt content atomically
    await promptsCol().updateOne(
      { _id: promptOid },
      {
        $push: { versions: newVersion } as any,
        $set: { content, updatedAt: new Date() },
      }
    );

    // Fetch author info for response
    const author = await usersCol().findOne(
      { _id: session.user.id as any },
      { projection: { name: 1, username: 1 } }
    );

    return NextResponse.json(
      {
        ...newVersion,
        id: newVersion._id,
        author: author
          ? { name: author.name, username: author.username }
          : null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Create version error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// GET - Get all versions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: promptId } = await params;

    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "server_error", message: "Something went wrong" },
        { status: 500 }
      );
    }

    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { versions: 1 } }
    );

    const versions = (prompt?.versions ?? []).slice().sort(
      (a, b) => b.version - a.version
    );

    // Fetch all authors in one query
    const authorIds = [...new Set(versions.map((v) => v.createdBy))];
    const authors = await usersCol()
      .find(
        { _id: { $in: authorIds as any } },
        { projection: { _id: 1, name: 1, username: 1 } }
      )
      .toArray();
    const authorMap = new Map(
      authors.map((a) => [a._id.toHexString(), { name: a.name, username: a.username }])
    );

    const result = versions.map((v) => ({
      ...v,
      id: v._id,
      author: authorMap.get(v.createdBy) ?? null,
    }));

    return NextResponse.json(result);
  } catch (error) {
    console.error("Get versions error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
