import { NextResponse } from "next/server";
import { connectMongo, promptsCol } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await connectMongo();
    await promptsCol().countDocuments({}, { limit: 1 });

    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
        database: "connected",
      },
      { status: 200 }
    );
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[health] MongoDB error:", err.constructor.name, err.message, err.cause);
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: err.message,
        errorType: err.constructor.name,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        cause: (err as any).cause ? String((err as any).cause) : undefined,
      },
      { status: 503 }
    );
  }
}
