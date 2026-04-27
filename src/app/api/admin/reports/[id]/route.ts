import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { promptsCol } from "@/lib/mongodb";

const updateSchema = z.object({
  status: z.enum(["PENDING", "REVIEWED", "DISMISSED"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { status } = updateSchema.parse(body);

    // Reports are embedded in prompts.reports[]; find the prompt containing this report
    const result = await promptsCol().findOneAndUpdate(
      { "reports._id": id },
      {
        $set: {
          "reports.$.status": status,
          "reports.$.updatedAt": new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const report = result.reports.find((r) => r._id === id);
    return NextResponse.json(report ?? { _id: id, status });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid data" }, { status: 400 });
    }
    console.error("Report update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
