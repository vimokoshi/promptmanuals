import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { EmbeddedReport, ReportReason } from "@/lib/mongodb";

const reportSchema = z.object({
  promptId: z.string().min(1),
  reason: z.enum(["SPAM", "INAPPROPRIATE", "COPYRIGHT", "MISLEADING", "RELIST_REQUEST", "OTHER"]),
  details: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { promptId, reason, details } = reportSchema.parse(body);

    const promptObjectId = /^[0-9a-fA-F]{24}$/.test(promptId)
      ? new ObjectId(promptId)
      : null;

    if (!promptObjectId) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Check if prompt exists
    const prompt = await promptsCol().findOne(
      { _id: promptObjectId },
      { projection: { _id: 1, authorId: 1, reports: 1 } }
    );

    if (!prompt) {
      return NextResponse.json({ error: "Prompt not found" }, { status: 404 });
    }

    // Prevent self-reporting (except for relist requests)
    if (prompt.authorId === session.user.id && reason !== "RELIST_REQUEST") {
      return NextResponse.json(
        { error: "You cannot report your own prompt" },
        { status: 400 }
      );
    }

    // Check if user already has a pending report for this prompt
    const existingReport = (prompt.reports ?? []).find(
      (r) => r.reporterId === session.user.id && r.status === "PENDING"
    );

    if (existingReport) {
      return NextResponse.json(
        { error: "You have already reported this prompt" },
        { status: 400 }
      );
    }

    // Embed the new report into the prompt document
    const now = new Date();
    const reportDoc: EmbeddedReport = {
      _id: new ObjectId().toHexString(),
      reason: reason as ReportReason,
      details: details ?? null,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      reporterId: session.user.id,
    };

    await promptsCol().updateOne(
      { _id: promptObjectId },
      { $push: { reports: reportDoc } as any }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request data" },
        { status: 400 }
      );
    }
    console.error("Report creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
