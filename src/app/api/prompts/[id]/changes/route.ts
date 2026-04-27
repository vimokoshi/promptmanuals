import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, changeRequestsCol, usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const createChangeRequestSchema = z.object({
  proposedContent: z.string().min(1),
  proposedTitle: z.string().optional(),
  reason: z.string().optional(),
});

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

    // Check if prompt exists
    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { authorId: 1, isPrivate: 1, content: 1, title: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    // Can't create change request for your own prompt
    if (prompt.authorId === session.user.id) {
      return NextResponse.json(
        { error: "forbidden", message: "You cannot create a change request for your own prompt" },
        { status: 403 }
      );
    }

    // Can't create change request for private prompts
    if (prompt.isPrivate) {
      return NextResponse.json(
        { error: "forbidden", message: "Cannot create change request for private prompts" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = createChangeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { proposedContent, proposedTitle, reason } = parsed.data;

    const now = new Date();
    const result = await changeRequestsCol().insertOne({
      originalContent: prompt.content,
      originalTitle: prompt.title,
      proposedContent,
      proposedTitle: proposedTitle ?? null,
      reason: reason ?? null,
      status: "PENDING",
      reviewNote: null,
      promptId,
      authorId: session.user.id,
      createdAt: now,
      updatedAt: now,
    } as any);

    const changeRequest = {
      id: result.insertedId.toHexString(),
      originalContent: prompt.content,
      originalTitle: prompt.title,
      proposedContent,
      proposedTitle: proposedTitle ?? null,
      reason: reason ?? null,
      status: "PENDING",
      reviewNote: null,
      promptId,
      authorId: session.user.id,
      createdAt: now,
      updatedAt: now,
    };

    return NextResponse.json(changeRequest, { status: 201 });
  } catch (error) {
    console.error("Create change request error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: promptId } = await params;

    const rawRequests = await changeRequestsCol()
      .find({ promptId })
      .sort({ createdAt: -1 })
      .toArray();

    // Fetch all authors in one query
    const authorIds = [...new Set(rawRequests.map((r) => r.authorId))];
    const authors = await usersCol()
      .find(
        { _id: { $in: authorIds as any } },
        { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
      )
      .toArray();
    const authorMap = new Map(
      authors.map((a) => [
        a._id.toHexString(),
        { id: a._id.toHexString(), name: a.name, username: a.username, avatar: a.avatar },
      ])
    );

    const changeRequests = rawRequests.map((r) => ({
      ...r,
      id: r._id.toHexString(),
      author: authorMap.get(r.authorId) ?? null,
    }));

    return NextResponse.json(changeRequests);
  } catch (error) {
    console.error("Get change requests error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
