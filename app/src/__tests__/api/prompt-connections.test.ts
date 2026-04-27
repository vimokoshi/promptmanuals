import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/prompts/[id]/connections/route";
import { auth } from "@/lib/auth";

// Valid 24-char hex ObjectIds
const PROMPT_ID = "507f1f77bcf86cd799439011";
const TARGET_ID = "507f1f77bcf86cd799439022";

const {
  mockPromptsCol,
  mockConnectionsCursor,
  mockConnectionsFind,
  mockConnectionsFindOne,
  mockConnectionsInsertOne,
  mockRefPromptsCursor,
} = vi.hoisted(() => {
  const mockRefPromptsCursor = {
    toArray: vi.fn().mockResolvedValue([]),
  };

  const mockConnectionsCursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };

  const mockConnectionsFind = vi.fn().mockReturnValue(mockConnectionsCursor);
  const mockConnectionsFindOne = vi.fn().mockResolvedValue(null);
  const mockConnectionsInsertOne = vi.fn().mockResolvedValue({
    insertedId: { toHexString: () => "newconnid" },
  });

  const mockPromptsCol = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue(mockRefPromptsCursor),
  };

  return {
    mockPromptsCol,
    mockConnectionsCursor,
    mockConnectionsFind,
    mockConnectionsFindOne,
    mockConnectionsInsertOne,
    mockRefPromptsCursor,
  };
});

vi.mock("@/lib/mongodb", () => ({
  promptsCol: vi.fn(() => mockPromptsCol),
  promptConnectionsCol: vi.fn(() => ({
    find: mockConnectionsFind,
    findOne: mockConnectionsFindOne,
    insertOne: mockConnectionsInsertOne,
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

describe("GET /api/prompts/[id]/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptsCol.findOne.mockResolvedValue(null);
    mockRefPromptsCursor.toArray.mockResolvedValue([]);
    mockPromptsCol.find.mockReturnValue(mockRefPromptsCursor);
    mockConnectionsCursor.sort.mockReturnThis();
    mockConnectionsCursor.limit.mockReturnThis();
    mockConnectionsCursor.toArray.mockResolvedValue([]);
    mockConnectionsFind.mockReturnValue(mockConnectionsCursor);
  });

  it("should return 404 for non-existent prompt (invalid id)", async () => {
    // "invalid-id" is not a valid ObjectId → route returns 404 immediately
    const request = new Request("http://localhost:3000/api/prompts/invalid-id/connections");
    const response = await GET(request, {
      params: Promise.resolve({ id: "invalid-id" }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Prompt not found");
  });

  it("should return 404 when prompt not found in database", async () => {
    // findOne returns null (default)
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`);
    const response = await GET(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Prompt not found");
  });

  it("should return empty connections for prompt with none", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: PROMPT_ID,
      isPrivate: false,
      authorId: "user1",
    });
    vi.mocked(auth).mockResolvedValue(null);
    // connectionsCursor returns [] for both outgoing and incoming calls (default)

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`);
    const response = await GET(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.outgoing).toEqual([]);
    expect(data.incoming).toEqual([]);
  });

  it("should return outgoing and incoming connections", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: { toHexString: () => PROMPT_ID },
      isPrivate: false,
      authorId: "user1",
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    // First find call (outgoing), second (incoming)
    mockConnectionsFind
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { _id: { toHexString: () => "conn1" }, sourceId: PROMPT_ID, targetId: TARGET_ID, label: "next", order: 0 },
        ]),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { _id: { toHexString: () => "conn2" }, sourceId: "507f1f77bcf86cd799439033", targetId: PROMPT_ID, label: "previous", order: 0 },
        ]),
      });

    // Referenced prompts fetch
    mockRefPromptsCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => TARGET_ID }, title: "Target", slug: "target", isPrivate: false, authorId: "user1" },
      { _id: { toHexString: () => "507f1f77bcf86cd799439033" }, title: "Source", slug: "source", isPrivate: false, authorId: "user2" },
    ]);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`);
    const response = await GET(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.outgoing).toHaveLength(1);
    expect(data.incoming).toHaveLength(1);
  });

  it("should filter out private prompts the user cannot see", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: { toHexString: () => PROMPT_ID },
      isPrivate: false,
      authorId: "user1",
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    mockConnectionsFind
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { _id: { toHexString: () => "conn1" }, sourceId: PROMPT_ID, targetId: TARGET_ID, label: "next", order: 0 },
        ]),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

    mockRefPromptsCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => TARGET_ID }, title: "Private", slug: "private", isPrivate: true, authorId: "other-user" },
    ]);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`);
    const response = await GET(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(data.outgoing).toHaveLength(0);
  });

  it("should show private prompts owned by the user", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: { toHexString: () => PROMPT_ID },
      isPrivate: false,
      authorId: "user1",
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    mockConnectionsFind
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([
          { _id: { toHexString: () => "conn1" }, sourceId: PROMPT_ID, targetId: TARGET_ID, label: "next", order: 0 },
        ]),
      })
      .mockReturnValueOnce({
        sort: vi.fn().mockReturnThis(),
        toArray: vi.fn().mockResolvedValue([]),
      });

    // Private prompt but owned by user1
    mockRefPromptsCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => TARGET_ID }, title: "My Private", slug: "private", isPrivate: true, authorId: "user1" },
    ]);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`);
    const response = await GET(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(data.outgoing).toHaveLength(1);
  });
});

describe("POST /api/prompts/[id]/connections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptsCol.findOne.mockResolvedValue(null);
    mockConnectionsFindOne.mockResolvedValue(null);
    mockConnectionsFind.mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      toArray: vi.fn().mockResolvedValue([]),
    });
    mockConnectionsInsertOne.mockResolvedValue({
      insertedId: { toHexString: () => "newconnid" },
    });
  });

  it("should return 401 if not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 404 if source prompt not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    // findOne returns null (default)

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Source prompt not found");
  });

  it("should return 403 if user does not own source prompt", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({ authorId: "other-user" });

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("You can only add connections to your own prompts");
  });

  it("should return 404 if target prompt not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "user1" }) // source found
      .mockResolvedValueOnce(null); // target not found

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Target prompt not found");
  });

  it("should return 403 if user does not own target prompt", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1", role: "USER" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "user1" })
      .mockResolvedValueOnce({ title: "Target", authorId: "other-user" });

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("You can only connect to your own prompts");
  });

  it("should return 400 for self-connection", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "user1" })
      .mockResolvedValueOnce({ title: "Same", authorId: "user1" });

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: PROMPT_ID, label: "next" }), // same as source
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Cannot connect a prompt to itself");
  });

  it("should return 400 if connection already exists", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "user1" })
      .mockResolvedValueOnce({ title: "Target", authorId: "user1" });
    mockConnectionsFindOne.mockResolvedValueOnce({ _id: "existing" });

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Connection already exists");
  });

  it("should create connection successfully", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "user1" })
      .mockResolvedValueOnce({ title: "Target", authorId: "user1" });
    mockConnectionsFindOne.mockResolvedValueOnce(null);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "next" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.label).toBe("next");
  });

  it("should return 400 for missing required fields", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID }), // Missing label
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });

    expect(response.status).toBe(400);
  });

  it("should allow admin to create connections for any prompt", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "admin1", role: "ADMIN" } } as never);
    mockPromptsCol.findOne
      .mockResolvedValueOnce({ authorId: "other-user" })
      .mockResolvedValueOnce({ title: "Target", authorId: "another-user" });
    mockConnectionsFindOne.mockResolvedValueOnce(null);

    const request = new Request(`http://localhost:3000/api/prompts/${PROMPT_ID}/connections`, {
      method: "POST",
      body: JSON.stringify({ targetId: TARGET_ID, label: "admin-link" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: PROMPT_ID }),
    });

    expect(response.status).toBe(201);
  });
});
