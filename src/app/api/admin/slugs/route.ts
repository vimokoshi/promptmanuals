import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";
import { generatePromptSlug } from "@/lib/slug";

export async function POST(request: Request) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "unauthorized", message: "Admin access required" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const regenerateAll = searchParams.get("regenerate") === "true";

    // Build query: either all active prompts or only those missing slugs
    const query = regenerateAll
      ? { deletedAt: null }
      : { slug: null, deletedAt: null };

    const prompts = await promptsCol()
      .find(query)
      .project<{ _id: import("mongodb").ObjectId; title: string }>({ _id: 1, title: 1 })
      .toArray();

    if (prompts.length === 0) {
      return NextResponse.json({
        success: true,
        updated: 0,
        message: "No prompts to update",
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let success = 0;
        let failed = 0;

        for (let i = 0; i < prompts.length; i++) {
          const prompt = prompts[i];

          try {
            const slug = await generatePromptSlug(prompt.title);

            await promptsCol().updateOne(
              { _id: prompt._id },
              { $set: { slug, updatedAt: new Date() } }
            );

            success++;
          } catch (error) {
            console.error(`Failed to generate slug for prompt ${prompt._id.toHexString()}:`, error);
            failed++;
          }

          const progress = {
            current: i + 1,
            total: prompts.length,
            success,
            failed,
            done: false,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`));
        }

        const finalResult = {
          current: prompts.length,
          total: prompts.length,
          success,
          failed,
          done: true,
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalResult)}\n\n`));
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
    console.error("Generate slugs error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}

// GET endpoint to check slug status
export async function GET() {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "unauthorized", message: "Admin access required" },
        { status: 401 }
      );
    }

    const [promptsWithoutSlugs, totalPrompts] = await Promise.all([
      promptsCol().countDocuments({ slug: null, deletedAt: null }),
      promptsCol().countDocuments({ deletedAt: null }),
    ]);

    return NextResponse.json({
      promptsWithoutSlugs,
      totalPrompts,
    });
  } catch (error) {
    console.error("Get slug status error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
