import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/health/route";

const mockCommand = vi.hoisted(() => vi.fn());

vi.mock("@/lib/mongodb", () => ({
  getClient: vi.fn(() => ({
    db: vi.fn(() => ({ command: mockCommand })),
  })),
}));

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return healthy status when database is connected", async () => {
    mockCommand.mockResolvedValueOnce({ ok: 1 });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.database).toBe("connected");
    expect(data.timestamp).toBeDefined();
  });

  it("should return unhealthy status when database is disconnected", async () => {
    mockCommand.mockRejectedValueOnce(new Error("Connection failed"));

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe("unhealthy");
    expect(data.database).toBe("disconnected");
    expect(data.error).toBe("Connection failed");
    expect(data.timestamp).toBeDefined();
  });

  it("should handle unknown error type", async () => {
    mockCommand.mockRejectedValueOnce("Unknown error");

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.status).toBe("unhealthy");
    expect(data.error).toBe("Unknown error");
  });

  it("should include ISO timestamp in response", async () => {
    mockCommand.mockResolvedValueOnce({ ok: 1 });

    const response = await GET();
    const data = await response.json();

    const timestamp = new Date(data.timestamp);
    expect(timestamp.toISOString()).toBe(data.timestamp);
  });
});
