import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { usersCol, promptsCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { findAndSaveRelatedPrompts } from "@/lib/ai/embeddings";
import { getConfig } from "@/lib/config";

export async function POST() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const user = await usersCol().findOne(
      { _id: new ObjectId(session.user.id) },
      { projection: { role: 1 } }
    );

    if (user?.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Check if AI search is enabled
    const config = await getConfig();
    if (!config.features.aiSearch) {
      return NextResponse.json(
        { error: "AI search is not enabled" },
        { status: 400 }
      );
    }

    // Get all public prompts with embeddings
    const prompts = await promptsCol()
      .find({ isPrivate: false, isUnlisted: false, deletedAt: null, embedding: { $ne: null } })
      .sort({ createdAt: -1 })
      .project({ _id: 1 })
      .toArray();

    if (prompts.length === 0) {
      return NextResponse.json({ error: "No prompts to process" }, { status: 400 });
    }

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let success = 0;
        let failed = 0;

        for (let i = 0; i < prompts.length; i++) {
          const prompt = prompts[i];

          const promptId = prompt._id.toHexString();
          try {
            await findAndSaveRelatedPrompts(promptId);
            success++;
          } catch (error) {
            console.error(`Failed to generate related prompts for ${promptId}:`, error);
            failed++;
          }

          // Send progress update
          const progress = {
            current: i + 1,
            total: prompts.length,
            success,
            failed,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        }

        // Send final result
        const result = { done: true, success, failed };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(result)}\n\n`));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Related prompts generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate related prompts" },
      { status: 500 }
    );
  }
}
