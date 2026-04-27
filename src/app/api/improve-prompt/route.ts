import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { improvePrompt } from "@/lib/ai/improve-prompt";
import { usersCol } from "@/lib/mongodb";
import { isValidApiKeyFormat } from "@/lib/api-key";
import { auth } from "@/lib/auth";

const requestSchema = z.object({
  prompt: z.string().min(1, "Prompt is required").max(10000, "Prompt too long"),
  outputFormat: z.enum(["text", "structured_json", "structured_yaml"]).default("text"),
  outputType: z.enum(["text", "image", "video", "sound"]).default("text"),
});

async function authenticateRequest(request: NextRequest) {
  // First check session auth
  const session = await auth();
  if (session?.user?.id) {
    return { id: session.user.id, username: session.user.name || "user" };
  }

  // Fall back to API key auth
  const apiKey =
    request.headers.get("x-api-key") ||
    request.headers.get("authorization")?.replace("Bearer ", "") ||
    request.headers.get("prompts-api-key");

  if (!apiKey || !isValidApiKeyFormat(apiKey)) {
    return null;
  }

  const user = await usersCol().findOne(
    { apiKey },
    { projection: { _id: 1, username: 1 } }
  );

  if (!user) return null;

  return { id: user._id.toHexString(), username: user.username ?? "user" };
}

export async function POST(request: NextRequest) {
  try {
    const user = await authenticateRequest(request);
    if (!user) {
      return NextResponse.json(
        { error: "Authentication required. Please log in or provide a valid API key." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validation = requestSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "Invalid request", details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { prompt, outputFormat, outputType } = validation.data;

    const result = await improvePrompt({ prompt, outputFormat, outputType });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error improving prompt:", error);

    if (error instanceof Error) {
      if (error.message.includes("rate limit")) {
        return NextResponse.json(
          { error: "Rate limit exceeded. Please try again later." },
          { status: 429 }
        );
      }
    }

    return NextResponse.json(
      { error: "An error occurred while improving the prompt" },
      { status: 500 }
    );
  }
}
