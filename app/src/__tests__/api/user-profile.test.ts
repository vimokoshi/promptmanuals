import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, PATCH } from "@/app/api/user/profile/route";
import { auth } from "@/lib/auth";

const { mockFindOne, mockFindOneAndUpdate } = vi.hoisted(() => ({
  mockFindOne: vi.fn().mockResolvedValue(null),
  mockFindOneAndUpdate: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/mongodb", () => ({
  usersCol: vi.fn(() => ({
    findOne: mockFindOne,
    findOneAndUpdate: mockFindOneAndUpdate,
  })),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

describe("GET /api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
  });

  it("should return 401 if not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("unauthorized");
  });

  it("should return 404 if user not found", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011" } } as never);
    // findOne returns null (default)

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("not_found");
  });

  it("should return user profile successfully", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011" } } as never);
    mockFindOne.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "Test User",
      username: "testuser",
      email: "test@example.com",
      avatar: "https://example.com/avatar.png",
      role: "USER",
      createdAt: new Date("2024-01-01"),
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.id).toBe("507f1f77bcf86cd799439011");
    expect(data.name).toBe("Test User");
    expect(data.username).toBe("testuser");
    expect(data.email).toBe("test@example.com");
    expect(data.role).toBe("USER");
  });

  it("should fetch user with correct projection", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011" } } as never);
    mockFindOne.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "Test",
      username: "test",
      email: "t@t.com",
      avatar: null,
      role: "USER",
      createdAt: new Date(),
    });

    await GET();

    expect(mockFindOne).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        projection: expect.objectContaining({
          name: 1,
          username: 1,
          email: 1,
          role: 1,
        }),
      })
    );
  });
});

describe("PATCH /api/user/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindOne.mockResolvedValue(null);
    mockFindOneAndUpdate.mockResolvedValue(null);
  });

  it("should return 401 if not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "New Name", username: "newuser" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("unauthorized");
  });

  it("should return 400 for invalid input - missing name", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ username: "testuser" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should return 400 for invalid input - missing username", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test User" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should return 400 for invalid username format", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test", username: "invalid user!" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should return 400 if username is taken", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1", username: "olduser" } } as never);
    mockFindOne.mockResolvedValueOnce({
      _id: { toHexString: () => "other-user" },
    });

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test", username: "takenuser" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("username_taken");
  });

  it("should allow keeping the same username", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011", username: "sameuser" } } as never);
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "Updated Name",
      username: "sameuser",
      email: "test@example.com",
      avatar: null,
      bio: null,
      customLinks: null,
    });

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Updated Name", username: "sameuser" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe("Updated Name");
    // Username unchanged → no findOne for duplicate check
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  it("should update profile successfully", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011", username: "olduser" } } as never);
    mockFindOne.mockResolvedValueOnce(null); // username not taken
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "New Name",
      username: "newuser",
      email: "test@example.com",
      avatar: "https://example.com/new-avatar.png",
      bio: null,
      customLinks: null,
    });

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "New Name",
        username: "newuser",
        avatar: "https://example.com/new-avatar.png",
      }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.name).toBe("New Name");
    expect(data.username).toBe("newuser");
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({
          name: "New Name",
          username: "newuser",
        }),
      }),
      expect.anything()
    );
  });

  it("should handle empty avatar string as null", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011", username: "testuser" } } as never);
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "Test",
      username: "testuser",
      email: "test@example.com",
      avatar: null,
      bio: null,
      customLinks: null,
    });

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test", username: "testuser", avatar: "" }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        $set: expect.objectContaining({ avatar: null }),
      }),
      expect.anything()
    );
  });

  it("should validate username length", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test", username: "a".repeat(31) }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should validate name length", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "user1" } } as never);

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "a".repeat(101), username: "testuser" }),
    });

    const response = await PATCH(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("validation_error");
  });

  it("should accept valid username with underscores", async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: "507f1f77bcf86cd799439011", username: "old" } } as never);
    mockFindOne.mockResolvedValueOnce(null);
    mockFindOneAndUpdate.mockResolvedValueOnce({
      _id: { toHexString: () => "507f1f77bcf86cd799439011" },
      name: "Test",
      username: "test_user_123",
      email: "test@example.com",
      avatar: null,
      bio: null,
      customLinks: null,
    });

    const request = new Request("http://localhost:3000/api/user/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Test", username: "test_user_123" }),
    });

    const response = await PATCH(request);

    expect(response.status).toBe(200);
  });
});
