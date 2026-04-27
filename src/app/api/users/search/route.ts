import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { usersCol } from "@/lib/mongodb";

export async function GET(request: Request) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json(
        { error: "unauthorized", message: "You must be logged in" },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim();

    if (!query || query.length < 1) {
      return NextResponse.json([]);
    }

    const users = await usersCol()
      .find(
        {
          $or: [
            { username: { $regex: query, $options: "i" } },
            { name: { $regex: query, $options: "i" } },
          ],
        },
        { projection: { _id: 1, username: 1, name: 1, avatar: 1 } }
      )
      .sort({ username: 1 })
      .limit(10)
      .toArray();

    return NextResponse.json(
      users.map((u) => ({
        id: u._id.toHexString(),
        username: u.username,
        name: u.name,
        avatar: u.avatar,
      }))
    );
  } catch (error) {
    console.error("User search error:", error);
    return NextResponse.json(
      { error: "server_error", message: "Something went wrong" },
      { status: 500 }
    );
  }
}
