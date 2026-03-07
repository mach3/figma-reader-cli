import { afterEach, describe, expect, it, vi } from "vitest";
import { getNodes } from "./inspect.js";

describe("getNodes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正しい API パスでリクエストする", async () => {
    const mockResponse = { name: "TestFile", nodes: {} };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getNodes({
      fileKey: "ABC123",
      nodeId: "1:23",
      token: "test-token",
    });

    expect(result.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://api.figma.com/v1/files/ABC123/nodes?ids=1%3A23", {
      headers: { "X-Figma-Token": "test-token" },
    });
  });

  it("depth パラメータを付与する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ nodes: {} }), { status: 200 }),
    );

    await getNodes({
      fileKey: "ABC123",
      nodeId: "1:23",
      token: "test-token",
      depth: 2,
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("depth=2");
  });

  it("geometry パラメータを付与する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ nodes: {} }), { status: 200 }),
    );

    await getNodes({
      fileKey: "ABC123",
      nodeId: "1:23",
      token: "test-token",
      geometry: true,
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("geometry=paths");
  });

  it("API エラー時に err を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    const result = await getNodes({
      fileKey: "INVALID",
      nodeId: "1:23",
      token: "test-token",
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });
});
