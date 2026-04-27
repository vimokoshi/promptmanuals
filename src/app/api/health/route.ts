import { NextResponse } from "next/server";
import { promptsCol } from "@/lib/mongodb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check database connection with a lightweight count
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
    return NextResponse.json(
      {
        status: "unhealthy",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 }
    );
  }
}
