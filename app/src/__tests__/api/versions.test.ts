import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/prompts/[id]/versions/route";
import { auth } from "@/lib/auth";

// Valid 24-char hex ObjectId for test use
const VALID_PROMPT_ID = "507f1f77bcf86cd799439011";

const { mockPromptsCol, mockUsersCol, mockUsersFindCursor } = vi.hoisted(() => {
  const mockUsersFindCursor = {
    toArray: vi.fn().mockResolvedValue([]),
  };
  const mockPromptsCol = {
    findOne: vi.fn().mockResolvedValue(null),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const mockUsersCol = {
    findOne: vi.fn().mockResolvedValue(null),
    find: vi.fn().mockReturnValue(mockUsersFindCursor),
  };
  return { mockPromptsCol, mockUsersCol, mockUsersFindCursor };
});

vi.mock("@/lib/mongodb", () => ({
  promptsCol: vi.fn(() => mockPromptsCol),
  usersCol: vi.fn(() => mockUsersCol),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

describe("GET /api/prompts/[id]/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptsCol.findOne.mockResolvedValue(null);
    mockUsersFindCursor.toArray.mockResolvedValue([]);
    mockUsersCol.find.mockReturnValue(mockUsersFindCursor);
  });

  it("should return empty array for prompt with no versions", async () => {
    // findOne returns null → versions = []
    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`);
    const response = await GET(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual([]);
  });

  it("should return versions ordered by version desc", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: VALID_PROMPT_ID,
      versions: [
        { _id: "v1", version: 1, content: "c1", changeNote: "Version 1", createdAt: new Date(), createdBy: "user1" },
        { _id: "v3", version: 3, content: "c3", changeNote: "Version 3", createdAt: new Date(), createdBy: "user1" },
        { _id: "v2", version: 2, content: "c2", changeNote: "Version 2", createdAt: new Date(), createdBy: "user1" },
      ],
    });
    mockUsersFindCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => "user1" }, name: "User", username: "user" },
    ]);

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`);
    const response = await GET(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveLength(3);
    expect(data[0].version).toBe(3);
    expect(data[1].version).toBe(2);
    expect(data[2].version).toBe(1);
  });

  it("should include author info in response", async () => {
    mockPromptsCol.findOne.mockResolvedValueOnce({
      _id: VALID_PROMPT_ID,
      versions: [
        { _id: "v1", version: 1, content: "Content", changeNote: "Initial", createdAt: new Date(), createdBy: "user1" },
      ],
    });
    mockUsersFindCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => "user1" }, name: "Test User", username: "testuser" },
    ]);

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`);
    const response = await GET(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data[0].author.name).toBe("Test User");
    expect(data[0].author.username).toBe("testuser");
  });

  it("should fetch versions from the prompt document", async () => {
    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`);
    await GET(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });

    expect(mockPromptsCol.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(Object) }),
      expect.objectContaining({ projection: { versions: 1 } })
    );
  });
});

describe("POST /api/prompts/[id]/versions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptsCol.findOne.mockResolvedValue(null);
    mockPromptsCol.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockUsersCol.findOne.mockResolvedValue(null);
  });

  it("should return 401 if not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("unauthorized");
  });

  it("should return 404 for non-existent prompt", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    // findOne returns null (default)

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("not_found");
  });

  it("should return 403 if user does not own the prompt", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "other-user",
      content: "Original content",
      versions: [],
    });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("forbidden");
  });

  it("should return 400 for empty content", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should return 400 for missing content", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should return 400 when content is same as current version", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Same content",
      versions: [],
    });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "Same content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("no_change");
  });

  it("should create version with incrementing version number", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [
        { _id: "v1", version: 1, content: "c1", changeNote: "v1", createdAt: new Date(), createdBy: "user1" },
        { _id: "v2", version: 2, content: "c2", changeNote: "v2", createdAt: new Date(), createdBy: "user1" },
      ],
    });
    mockUsersCol.findOne.mockResolvedValueOnce({ name: "User", username: "user" });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.version).toBe(3);
  });

  it("should start at version 1 when no previous versions exist", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });
    mockUsersCol.findOne.mockResolvedValueOnce({ name: "User", username: "user" });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.version).toBe(1);
  });

  it("should use default changeNote when not provided", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });
    mockUsersCol.findOne.mockResolvedValueOnce({ name: "User", username: "user" });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.changeNote).toBe("Version 1");
  });

  it("should use custom changeNote when provided", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });
    mockUsersCol.findOne.mockResolvedValueOnce({ name: "User", username: "user" });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content", changeNote: "Fixed typo in instructions" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.changeNote).toBe("Fixed typo in instructions");
  });

  it("should return created version with author info", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);
    mockPromptsCol.findOne.mockResolvedValueOnce({
      authorId: "user1",
      content: "Original content",
      versions: [],
    });
    mockUsersCol.findOne.mockResolvedValueOnce({ name: "Test User", username: "testuser" });

    const request = new Request(`http://localhost:3000/api/prompts/${VALID_PROMPT_ID}/versions`, {
      method: "POST",
      body: JSON.stringify({ content: "New content" }),
    });
    const response = await POST(request, {
      params: Promise.resolve({ id: VALID_PROMPT_ID }),
    });
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.author.name).toBe("Test User");
    expect(data.author.username).toBe("testuser");
  });
});
