import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { usersCol, promptsCol } from "@/lib/mongodb";
import { Filter } from "mongodb";
import type { UserDocument } from "@/lib/mongodb";

// GET - List all users for admin with pagination and search
export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }

    if (session.user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "forbidden", message: "Admin access required" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || "";
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const filter = searchParams.get("filter") || "all";

    const validPage = Math.max(1, page);
    const validLimit = Math.min(Math.max(1, limit), 100);
    const skip = (validPage - 1) * validLimit;

    // Build MongoDB filter
    const mongoFilter: Filter<UserDocument> = {};

    switch (filter) {
      case "admin":
        mongoFilter.role = "ADMIN";
        break;
      case "user":
        mongoFilter.role = "USER";
        break;
      case "verified":
        mongoFilter.verified = true;
        break;
      case "unverified":
        mongoFilter.verified = false;
        break;
      case "flagged":
        mongoFilter.flagged = true;
        break;
      default:
        break;
    }

    if (search) {
      const regex = { $regex: search, $options: "i" };
      (mongoFilter as Record<string, unknown>).$or = [
        { email: regex },
        { username: regex },
        { name: regex },
      ];
    }

    // Sort field validation
    const validSortFields = ["createdAt", "email", "username", "name"];
    const sortField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const sortDir = sortOrder === "asc" ? 1 : -1;

    const [rawUsers, total] = await Promise.all([
      usersCol()
        .find(mongoFilter)
        .sort({ [sortField]: sortDir })
        .skip(skip)
        .limit(validLimit)
        .toArray(),
      usersCol().countDocuments(mongoFilter),
    ]);

    // Fetch prompt counts per user
    const userIds = rawUsers.map((u) => u._id.toHexString());
    const promptCounts = await promptsCol()
      .aggregate<{ _id: string; count: number }>([
        { $match: { authorId: { $in: userIds }, deletedAt: null } },
        { $group: { _id: "$authorId", count: { $sum: 1 } } },
      ])
      .toArray();

    const countMap = new Map(promptCounts.map((p) => [p._id, p.count]));

    const users = rawUsers.map((u) => ({
      id: u._id.toHexString(),
      email: u.email,
      username: u.username,
      name: u.name,
      avatar: u.avatar,
      role: u.role,
      verified: u.verified,
      flagged: u.flagged,
      flaggedAt: u.flaggedAt,
      flaggedReason: u.flaggedReason,
      dailyGenerationLimit: u.dailyGenerationLimit,
      generationCreditsRemaining: u.generationCreditsRemaining,
      createdAt: u.createdAt,
      _count: { prompts: countMap.get(u._id.toHexString()) ?? 0 },
    }));

    return NextResponse.json({
      users,
      pagination: {
        page: validPage,
        limit: validLimit,
        total,
        totalPages: Math.ceil(total / validLimit),
      },
    });
  } catch (error) {
    console.error("Admin list users error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
