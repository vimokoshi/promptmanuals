import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  notificationsCol,
  usersCol,
  promptsCol,
  changeRequestsCol,
} from "@/lib/mongodb";
import { ObjectId } from "mongodb";

const DEFAULT_RESPONSE = {
  pendingChangeRequests: 0,
  unreadComments: 0,
  commentNotifications: [],
};

export async function GET() {
  let session;
  try {
    session = await auth();
  } catch (error) {
    console.error("Auth error in notifications:", error);
    return NextResponse.json(DEFAULT_RESPONSE);
  }

  if (!session?.user?.id) {
    return NextResponse.json(DEFAULT_RESPONSE);
  }

  const userId = session.user.id;

  try {
    // Find all prompt IDs authored by this user to count pending change requests
    const userPrompts = await promptsCol()
      .find({ authorId: userId }, { projection: { _id: 1 } })
      .toArray();
    const userPromptIds = userPrompts.map((p) => p._id.toHexString());

    // Count pending change requests on user's prompts
    const pendingCount = await changeRequestsCol().countDocuments({
      status: "PENDING",
      promptId: { $in: userPromptIds },
    });

    // Get unread comment notifications
    const rawNotifications = await notificationsCol()
      .find({
        userId,
        read: false,
        type: { $in: ["COMMENT", "REPLY"] },
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray();

    // Resolve actor details
    const actorIds = [
      ...new Set(
        rawNotifications.map((n) => n.actorId).filter(Boolean) as string[]
      ),
    ];
    const actorObjectIds = actorIds.flatMap((id) => {
      try {
        return [new ObjectId(id)];
      } catch {
        return [];
      }
    });

    const actors = actorObjectIds.length
      ? await usersCol()
          .find(
            { _id: { $in: actorObjectIds } },
            { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
          )
          .toArray()
      : [];
    const actorMap = new Map(
      actors.map((a) => [
        a._id.toHexString(),
        {
          id: a._id.toHexString(),
          name: a.name,
          username: a.username,
          avatar: a.avatar,
        },
      ])
    );

    // Get prompt titles for notifications
    const promptIds = [
      ...new Set(
        rawNotifications.map((n) => n.promptId).filter(Boolean) as string[]
      ),
    ];
    const promptObjectIds = promptIds.flatMap((id) => {
      try {
        return [new ObjectId(id)];
      } catch {
        return [];
      }
    });

    const prompts = promptObjectIds.length
      ? await promptsCol()
          .find(
            { _id: { $in: promptObjectIds } },
            { projection: { _id: 1, title: 1 } }
          )
          .toArray()
      : [];
    const promptMap = new Map(
      prompts.map((p) => [p._id.toHexString(), p.title])
    );

    const formattedNotifications = rawNotifications.map((n) => ({
      id: n._id.toHexString(),
      type: n.type,
      createdAt: n.createdAt,
      actor: n.actorId ? (actorMap.get(n.actorId) ?? null) : null,
      promptId: n.promptId,
      promptTitle: n.promptId ? (promptMap.get(n.promptId) ?? null) : null,
    }));

    return NextResponse.json({
      pendingChangeRequests: pendingCount,
      unreadComments: rawNotifications.length,
      commentNotifications: formattedNotifications,
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    return NextResponse.json(DEFAULT_RESPONSE);
  }
}

// POST - Mark notifications as read
export async function POST(request: Request) {
  let session;
  try {
    session = await auth();
  } catch (error) {
    console.error("Auth error in notifications:", error);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const body = await request.json();
    const { notificationIds } = body;

    if (notificationIds && Array.isArray(notificationIds)) {
      // Mark specific notifications as read
      const objectIds = (notificationIds as string[]).flatMap((id) => {
        try {
          return [new ObjectId(id)];
        } catch {
          return [];
        }
      });
      if (objectIds.length) {
        await notificationsCol().updateMany(
          { _id: { $in: objectIds }, userId },
          { $set: { read: true } }
        );
      }
    } else {
      // Mark all notifications as read
      await notificationsCol().updateMany(
        { userId, read: false },
        { $set: { read: true } }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
