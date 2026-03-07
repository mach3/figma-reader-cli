import { afterEach, describe, expect, it, vi } from "vitest";
import { getVariables } from "./variables.js";

describe("getVariables", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("local エンドポイントにリクエストする", async () => {
    const mockResponse = {
      status: 200,
      error: false,
      meta: { variables: {}, variableCollections: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getVariables({
      fileKey: "ABC123",
      token: "test-token",
      published: false,
    });

    expect(result.isOk()).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://api.figma.com/v1/files/ABC123/variables/local", {
      headers: { "X-Figma-Token": "test-token" },
    });
  });

  it("published フラグで published エンドポイントに切り替わる", async () => {
    const mockResponse = {
      status: 200,
      error: false,
      meta: { variables: {}, variableCollections: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await getVariables({
      fileKey: "ABC123",
      token: "test-token",
      published: true,
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.figma.com/v1/files/ABC123/variables/published",
      { headers: { "X-Figma-Token": "test-token" } },
    );
  });

  it("API エラー時に err を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Forbidden", { status: 403 }));

    const result = await getVariables({
      fileKey: "ABC123",
      token: "test-token",
      published: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });

  it("レスポンスの error フィールドが true の場合 err を返す", async () => {
    const mockResponse = {
      status: 400,
      error: true,
      meta: { variables: {}, variableCollections: {} },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getVariables({
      fileKey: "ABC123",
      token: "test-token",
      published: false,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      type: "API_ERROR",
      status: 400,
    });
  });
});
