import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Update user (role change, verification, flagging, generation limits)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const body = await request.json();
    const { role, verified, flagged, flaggedReason, dailyGenerationLimit } = body;

    const setFields: Record<string, unknown> = { updatedAt: new Date() };

    if (role !== undefined) {
      if (!["ADMIN", "USER"].includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      setFields.role = role;
    }

    if (verified !== undefined) {
      setFields.verified = verified;
    }

    if (flagged !== undefined) {
      setFields.flagged = flagged;
      if (flagged) {
        setFields.flaggedAt = new Date();
        setFields.flaggedReason = flaggedReason || null;
      } else {
        setFields.flaggedAt = null;
        setFields.flaggedReason = null;
      }
    }

    if (dailyGenerationLimit !== undefined) {
      const lim = parseInt(dailyGenerationLimit, 10);
      if (isNaN(lim) || lim < 0) {
        return NextResponse.json({ error: "Invalid daily generation limit" }, { status: 400 });
      }
      setFields.dailyGenerationLimit = lim;
      setFields.generationCreditsRemaining = lim;
    }

    const updated = await usersCol().findOneAndUpdate(
      { _id: objectId },
      { $set: setFields },
      { returnDocument: "after" }
    );

    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated._id.toHexString(),
      email: updated.email,
      username: updated.username,
      name: updated.name,
      avatar: updated.avatar,
      role: updated.role,
      verified: updated.verified,
      flagged: updated.flagged,
      flaggedAt: updated.flaggedAt,
      flaggedReason: updated.flaggedReason,
      dailyGenerationLimit: updated.dailyGenerationLimit,
      generationCreditsRemaining: updated.generationCreditsRemaining,
      createdAt: updated.createdAt,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}

// Delete user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Don't allow deleting yourself
    if (id === session.user.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    let objectId: ObjectId;
    try {
      objectId = new ObjectId(id);
    } catch {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const result = await usersCol().deleteOne({ _id: objectId });

    if (result.deletedCount === 0) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
