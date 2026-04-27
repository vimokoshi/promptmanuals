import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { webhookConfigsCol } from "@/lib/mongodb";
import type { WebhookEvent } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import { isPrivateUrl } from "@/lib/webhook";

const VALID_METHODS = ["GET", "POST", "PUT", "PATCH"];
const VALID_EVENTS = ["PROMPT_CREATED", "PROMPT_UPDATED", "PROMPT_DELETED"];

interface UpdateWebhookData {
  name?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string> | null;
  payload?: string;
  events?: WebhookEvent[];
  isEnabled?: boolean;
}

function validateUpdateWebhook(body: unknown): { success: true; data: UpdateWebhookData } | { success: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { success: false, error: "Invalid request body" };
  }

  const data = body as Record<string, unknown>;
  const result: UpdateWebhookData = {};

  if (data.name !== undefined) {
    if (typeof data.name !== "string" || data.name.length < 1 || data.name.length > 100) {
      return { success: false, error: "Name must be a string between 1 and 100 characters" };
    }
    result.name = data.name;
  }

  if (data.url !== undefined) {
    if (typeof data.url !== "string") {
      return { success: false, error: "URL must be a string" };
    }
    try {
      new URL(data.url);
    } catch {
      return { success: false, error: "Invalid URL format" };
    }
    // A10: Block private/internal URLs to prevent SSRF
    if (isPrivateUrl(data.url)) {
      return { success: false, error: "Webhook URL cannot target private/internal networks" };
    }
    result.url = data.url;
  }

  if (data.method !== undefined) {
    if (typeof data.method !== "string" || !VALID_METHODS.includes(data.method)) {
      return { success: false, error: `Method must be one of: ${VALID_METHODS.join(", ")}` };
    }
    result.method = data.method;
  }

  if (data.headers !== undefined) {
    if (data.headers !== null && typeof data.headers !== "object") {
      return { success: false, error: "Headers must be an object or null" };
    }
    result.headers = data.headers as Record<string, string> | null;
  }

  if (data.payload !== undefined) {
    if (typeof data.payload !== "string" || data.payload.length < 1) {
      return { success: false, error: "Payload must be a non-empty string" };
    }
    result.payload = data.payload;
  }

  if (data.events !== undefined) {
    if (!Array.isArray(data.events) || !data.events.every(e => typeof e === "string" && VALID_EVENTS.includes(e))) {
      return { success: false, error: `Events must be an array of: ${VALID_EVENTS.join(", ")}` };
    }
    result.events = data.events as WebhookEvent[];
  }

  if (data.isEnabled !== undefined) {
    if (typeof data.isEnabled !== "boolean") {
      return { success: false, error: "isEnabled must be a boolean" };
    }
    result.isEnabled = data.isEnabled;
  }

  return { success: true, data: result };
}

// GET single webhook
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const webhook = await webhookConfigsCol().findOne({ _id: objectId });

    if (!webhook) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ...webhook, id: webhook._id.toHexString() });
  } catch (error) {
    console.error("Get webhook error:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// UPDATE webhook
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = validateUpdateWebhook(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: "validation_error", details: validation.error },
        { status: 400 }
      );
    }

    const result = await webhookConfigsCol().findOneAndUpdate(
      { _id: objectId },
      { $set: { ...validation.data, updatedAt: new Date() } },
      { returnDocument: "after" }
    );

    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ ...result, id: result._id.toHexString() });
  } catch (error) {
    console.error("Update webhook error:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

// DELETE webhook
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const deleteResult = await webhookConfigsCol().deleteOne({ _id: objectId });

    if (deleteResult.deletedCount === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete webhook error:", error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
