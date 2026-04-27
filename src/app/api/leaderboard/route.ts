import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { promptsCol, usersCol } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

// Cache leaderboard data for 1 hour (3600 seconds)
const getLeaderboard = unstable_cache(
  async (period: string) => {
    // Calculate date filters
    const now = new Date();
    let dateFilter: Date | undefined;

    if (period === "week") {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "month") {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Aggregate vote counts per prompt author using embedded votes array
    // votes[] is an array of { userId, createdAt } embedded on each prompt
    const voteAggPipeline: object[] = [
      {
        $match: {
          isPrivate: false,
          deletedAt: null,
          ...(dateFilter ? { "votes.createdAt": { $gte: dateFilter } } : {}),
        },
      },
      { $unwind: { path: "$votes", preserveNullAndEmpty: false } },
      ...(dateFilter
        ? [{ $match: { "votes.createdAt": { $gte: dateFilter } } }]
        : []),
      {
        $group: {
          _id: "$authorId",
          totalUpvotes: { $sum: 1 },
        },
      },
      { $sort: { totalUpvotes: -1 } },
      { $limit: 50 },
    ];

    const votesPerAuthor = await promptsCol()
      .aggregate<{ _id: string; totalUpvotes: number }>(voteAggPipeline)
      .toArray();

    const topAuthorIds = votesPerAuthor.map((v) => v._id);

    // Map authorId → totalUpvotes
    const authorVoteCounts = new Map<string, number>(
      votesPerAuthor.map((v) => [v._id, v.totalUpvotes])
    );

    // Fetch prompt counts for top authors
    const promptCountPipeline: object[] = [
      {
        $match: {
          isPrivate: false,
          deletedAt: null,
          authorId: { $in: topAuthorIds },
          ...(dateFilter ? { createdAt: { $gte: dateFilter } } : {}),
        },
      },
      { $group: { _id: "$authorId", promptCount: { $sum: 1 } } },
    ];

    const promptCounts = await promptsCol()
      .aggregate<{ _id: string; promptCount: number }>(promptCountPipeline)
      .toArray();

    const promptCountMap = new Map<string, number>(
      promptCounts.map((p) => [p._id, p.promptCount])
    );

    // Fetch user details for top authors
    const topAuthorObjectIds = topAuthorIds
      .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
      .map((id) => new ObjectId(id));

    const topUsers = topAuthorObjectIds.length
      ? await usersCol()
          .find(
            { _id: { $in: topAuthorObjectIds } },
            { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
          )
          .toArray()
      : [];

    let leaderboard = topUsers
      .map((user) => {
        const uid = user._id.toHexString();
        return {
          id: uid,
          name: user.name,
          username: user.username,
          avatar: user.avatar,
          totalUpvotes: authorVoteCounts.get(uid) ?? 0,
          promptCount: promptCountMap.get(uid) ?? 0,
        };
      })
      .sort((a, b) => b.totalUpvotes - a.totalUpvotes);

    const MIN_USERS = 10;

    // Fill remaining slots with active users who have public prompts
    if (leaderboard.length < MIN_USERS) {
      const existingUserIds = new Set(leaderboard.map((u) => u.id));

      // Find authors with public prompts in period that aren't already listed
      const fillPipeline: object[] = [
        {
          $match: {
            isPrivate: false,
            deletedAt: null,
            ...(dateFilter ? { createdAt: { $gte: dateFilter } } : {}),
          },
        },
        { $group: { _id: "$authorId", promptCount: { $sum: 1 } } },
        { $sort: { promptCount: -1 } },
        { $limit: MIN_USERS * 5 }, // over-fetch to filter already-listed users
      ];

      const fillAuthors = await promptsCol()
        .aggregate<{ _id: string; promptCount: number }>(fillPipeline)
        .toArray();

      const fillAuthorIds = fillAuthors
        .map((a) => a._id)
        .filter((id) => !existingUserIds.has(id))
        .slice(0, MIN_USERS - leaderboard.length);

      const fillObjectIds = fillAuthorIds
        .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
        .map((id) => new ObjectId(id));

      const fillUsers = fillObjectIds.length
        ? await usersCol()
            .find(
              { _id: { $in: fillObjectIds } },
              { projection: { _id: 1, name: 1, username: 1, avatar: 1 } }
            )
            .toArray()
        : [];

      const fillCountMap = new Map<string, number>(
        fillAuthors.map((a) => [a._id, a.promptCount])
      );

      const additionalUsers = fillUsers.map((user) => {
        const uid = user._id.toHexString();
        return {
          id: uid,
          name: user.name,
          username: user.username,
          avatar: user.avatar,
          totalUpvotes: 0,
          promptCount: fillCountMap.get(uid) ?? 0,
        };
      });

      leaderboard = [...leaderboard, ...additionalUsers];
    }

    return { period, leaderboard };
  },
  ["leaderboard"],
  { tags: ["leaderboard"], revalidate: 3600 }
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all"; // all, month, week

    const result = await getLeaderboard(period);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
