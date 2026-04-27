import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol, changeRequestsCol, usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { randomUUID } from "crypto";

const updateChangeRequestSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "PENDING"]),
  reviewNote: z.string().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; changeId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId, changeId } = await params;

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
      { projection: { authorId: 1, content: 1, title: 1, versions: 1 } }
    );

    if (!prompt) {
      return NextResponse.json(
        { error: "not_found", message: "Prompt not found" },
        { status: 404 }
      );
    }

    if (prompt.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "forbidden", message: "Only the prompt owner can review change requests" },
        { status: 403 }
      );
    }

    let changeOid: ObjectId;
    try {
      changeOid = new ObjectId(changeId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    // Get change request
    const changeRequest = await changeRequestsCol().findOne({ _id: changeOid });

    if (!changeRequest || changeRequest.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    // Fetch author username for change note
    const crAuthor = await usersCol().findOne(
      { _id: changeRequest.authorId as any },
      { projection: { username: 1 } }
    );

    const body = await request.json();
    const parsed = updateChangeRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_error", message: "Invalid input", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { status, reviewNote } = parsed.data;

    // Validate state transitions
    if (changeRequest.status === "PENDING" && status === "PENDING") {
      return NextResponse.json(
        { error: "invalid_state", message: "Change request is already pending" },
        { status: 400 }
      );
    }

    if (changeRequest.status === "APPROVED") {
      return NextResponse.json(
        { error: "invalid_state", message: "Cannot modify an approved change request" },
        { status: 400 }
      );
    }

    // Allow reopening rejected requests (REJECTED -> PENDING)
    if (changeRequest.status === "REJECTED" && status !== "PENDING") {
      return NextResponse.json(
        { error: "invalid_state", message: "Rejected requests can only be reopened" },
        { status: 400 }
      );
    }

    const now = new Date();

    // If reopening, just update status
    if (status === "PENDING") {
      await changeRequestsCol().updateOne(
        { _id: changeOid },
        { $set: { status, reviewNote: null, updatedAt: now } }
      );
      return NextResponse.json({ success: true, status });
    }

    // If approving, also update the prompt content
    if (status === "APPROVED") {
      // Get current version number from embedded array
      const versions = prompt.versions ?? [];
      const latestVersionNum = versions.reduce(
        (max, v) => Math.max(max, v.version),
        0
      );
      const nextVersion = latestVersionNum + 1;

      // Build change note with contributor info
      const changeNote = changeRequest.reason
        ? `Contribution by @${crAuthor?.username ?? changeRequest.authorId}: ${changeRequest.reason}`
        : `Contribution by @${crAuthor?.username ?? changeRequest.authorId}`;

      const newVersion = {
        _id: randomUUID(),
        version: nextVersion,
        content: changeRequest.proposedContent,
        changeNote,
        createdAt: now,
        createdBy: changeRequest.authorId,
      };

      // Execute all updates
      await Promise.all([
        // Push new version + update prompt content
        promptsCol().updateOne(
          { _id: promptOid },
          {
            $push: { versions: newVersion } as any,
            $set: {
              content: changeRequest.proposedContent,
              ...(changeRequest.proposedTitle && { title: changeRequest.proposedTitle }),
              updatedAt: now,
            },
          }
        ),
        // Update change request status
        changeRequestsCol().updateOne(
          { _id: changeOid },
          { $set: { status, reviewNote: reviewNote ?? null, updatedAt: now } }
        ),
      ]);
    } else {
      // Just update the change request status
      await changeRequestsCol().updateOne(
        { _id: changeOid },
        { $set: { status, reviewNote: reviewNote ?? null, updatedAt: now } }
      );
    }

    return NextResponse.json({ success: true, status });
  } catch (error) {
    console.error("Update change request error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; changeId: string }> }
) {
  try {
    const { id: promptId, changeId } = await params;

    let changeOid: ObjectId;
    try {
      changeOid = new ObjectId(changeId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    const changeRequest = await changeRequestsCol().findOne({ _id: changeOid });

    if (!changeRequest || changeRequest.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    // Fetch author
    const author = await usersCol().findOne(
      { _id: changeRequest.authorId as any },
      { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
    );

    // Fetch prompt info
    let promptOid: ObjectId;
    try {
      promptOid = new ObjectId(promptId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }
    const prompt = await promptsCol().findOne(
      { _id: promptOid },
      { projection: { _id: 1, title: 1, content: 1 } }
    );

    const result = {
      ...changeRequest,
      id: changeRequest._id.toHexString(),
      author: author
        ? {
            id: author._id.toHexString(),
            name: author.name,
            username: author.username,
            avatar: author.avatar,
          }
        : null,
      prompt: prompt
        ? {
            id: prompt._id.toHexString(),
            title: prompt.title,
            content: prompt.content,
          }
        : null,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Get change request error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; changeId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { id: promptId, changeId } = await params;

    let changeOid: ObjectId;
    try {
      changeOid = new ObjectId(changeId);
    } catch {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    // Get change request
    const changeRequest = await changeRequestsCol().findOne(
      { _id: changeOid },
      { projection: { promptId: 1, status: 1, authorId: 1 } }
    );

    if (!changeRequest || changeRequest.promptId !== promptId) {
      return NextResponse.json(
        { error: "not_found", message: "Change request not found" },
        { status: 404 }
      );
    }

    // Only the author can dismiss their own change request
    if (changeRequest.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "forbidden", message: "Only the author can dismiss their change request" },
        { status: 403 }
      );
    }

    // Can only dismiss pending change requests
    if (changeRequest.status !== "PENDING") {
      return NextResponse.json(
        { error: "invalid_state", message: "Only pending change requests can be dismissed" },
        { status: 400 }
      );
    }

    // Delete the change request
    await changeRequestsCol().deleteOne({ _id: changeOid });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete change request error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
