import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { generateApiKey } from "@/lib/api-key";

export const runtime = "nodejs";

export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await usersCol().findOne(
    { _id: userId },
    { projection: { apiKey: 1, mcpPromptsPublicByDefault: 1 } }
  );

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    hasApiKey: !!user.apiKey,
    apiKey: user.apiKey,
    mcpPromptsPublicByDefault: user.mcpPromptsPublicByDefault,
  });
}

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = generateApiKey();

  await usersCol().findOneAndUpdate(
    { _id: userId },
    { $set: { apiKey, updatedAt: new Date() } }
  );

  return NextResponse.json({ apiKey });
}

export async function DELETE() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await usersCol().findOneAndUpdate(
    { _id: userId },
    { $set: { apiKey: null, updatedAt: new Date() } }
  );

  return NextResponse.json({ success: true });
}

export async function PATCH(request: Request) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let userId: ObjectId;
  try {
    userId = new ObjectId(session.user.id);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { mcpPromptsPublicByDefault } = body;

  if (typeof mcpPromptsPublicByDefault !== "boolean") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  await usersCol().findOneAndUpdate(
    { _id: userId },
    { $set: { mcpPromptsPublicByDefault, updatedAt: new Date() } }
  );

  return NextResponse.json({ success: true });
}
