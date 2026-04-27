import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/prompts/search/route";
import { auth } from "@/lib/auth";

const { mockPromptsCursor, mockPromptsFind, mockUsersFind } = vi.hoisted(() => {
  const mockPromptsCursor = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    toArray: vi.fn().mockResolvedValue([]),
  };
  const mockPromptsFind = vi.fn().mockReturnValue(mockPromptsCursor);
  const mockUsersFind = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
  return { mockPromptsCursor, mockPromptsFind, mockUsersFind };
});

vi.mock("@/lib/mongodb", () => ({
  promptsCol: vi.fn(() => ({ find: mockPromptsFind })),
  usersCol: vi.fn(() => ({ find: mockUsersFind })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

describe("GET /api/prompts/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPromptsCursor.sort.mockReturnThis();
    mockPromptsCursor.limit.mockReturnThis();
    mockPromptsCursor.toArray.mockResolvedValue([]);
    mockPromptsFind.mockReturnValue(mockPromptsCursor);
    mockUsersFind.mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
  });

  it("should return empty array for query shorter than 2 characters", async () => {
    const request = new Request("http://localhost:3000/api/prompts/search?q=a");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.prompts).toEqual([]);
    expect(mockPromptsFind).not.toHaveBeenCalled();
  });

  it("should return empty array for empty query", async () => {
    const request = new Request("http://localhost:3000/api/prompts/search?q=");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.prompts).toEqual([]);
  });

  it("should return empty array for missing query", async () => {
    const request = new Request("http://localhost:3000/api/prompts/search");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.prompts).toEqual([]);
  });

  it("should search prompts with valid query", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    mockPromptsCursor.toArray.mockResolvedValueOnce([
      {
        _id: { toHexString: () => "1" },
        title: "Test Prompt",
        slug: "test-prompt",
        authorId: "author1",
      },
    ]);
    mockUsersFind.mockReturnValueOnce({
      toArray: vi.fn().mockResolvedValue([
        { _id: { toHexString: () => "author1" }, username: "testuser" },
      ]),
    });

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.prompts).toHaveLength(1);
    expect(data.prompts[0].title).toBe("Test Prompt");
  });

  it("should respect limit parameter", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test&limit=5");

    await GET(request);

    expect(mockPromptsCursor.limit).toHaveBeenCalledWith(5);
  });

  it("should cap limit at 50", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test&limit=100");

    await GET(request);

    expect(mockPromptsCursor.limit).toHaveBeenCalledWith(50);
  });

  it("should use default limit of 10", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    await GET(request);

    expect(mockPromptsCursor.limit).toHaveBeenCalledWith(10);
  });

  it("should filter public prompts for unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    await GET(request);

    expect(mockPromptsFind).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: null,
        isUnlisted: false,
        isPrivate: false,
      }),
      expect.anything()
    );
  });

  it("should include user's private prompts for authenticated users", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    await GET(request);

    expect(mockPromptsFind).toHaveBeenCalled();
    const callArg = mockPromptsFind.mock.calls[0][0];
    expect(callArg.$or).toBeDefined();
  });

  it("should filter to owner-only prompts when ownerOnly=true", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test&ownerOnly=true");

    await GET(request);

    expect(mockPromptsFind).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "user1" }),
      expect.anything()
    );
  });

  it("should handle comma-separated keywords", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    mockPromptsCursor.toArray.mockResolvedValueOnce([
      { _id: { toHexString: () => "1" }, title: "Coding Helper", slug: "coding-helper", authorId: "u1" },
    ]);
    mockUsersFind.mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([]) });

    const request = new Request("http://localhost:3000/api/prompts/search?q=coding,helper");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mockPromptsFind).toHaveBeenCalled();
  });

  it("should order results by featured then viewCount", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    await GET(request);

    expect(mockPromptsCursor.sort).toHaveBeenCalledWith({ isFeatured: -1, viewCount: -1 });
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(auth).mockResolvedValue(null);
    mockPromptsCursor.toArray.mockRejectedValueOnce(new Error("Database error"));

    const request = new Request("http://localhost:3000/api/prompts/search?q=test");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Search failed");
  });

  it("should handle special characters in query", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/prompts/search?q=test%20query%20with%20spaces");

    const response = await GET(request);

    expect(response.status).toBe(200);
  });
});
