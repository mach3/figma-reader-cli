import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { figmaGet } from "../../src/lib/figma-client.js";

describe("figmaGet", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("成功時にデータを返す", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: "123", handle: "test" }),
    });

    const result = await figmaGet<{ id: string; handle: string }>("token", "/v1/me");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({ id: "123", handle: "test" });

    expect(mockFetch).toHaveBeenCalledWith("https://api.figma.com/v1/me", {
      headers: { "X-Figma-Token": "token" },
    });
  });

  it("HTTP エラー時に API_ERROR を返す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve("Forbidden"),
    });

    const result = await figmaGet("token", "/v1/me");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      type: "API_ERROR",
      status: 403,
      message: "Forbidden",
    });
  });

  it("ネットワークエラー時に NETWORK_ERROR を返す", async () => {
    const networkError = new Error("fetch failed");
    mockFetch.mockRejectedValue(networkError);

    const result = await figmaGet("token", "/v1/me");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      type: "NETWORK_ERROR",
      cause: networkError,
    });
  });
});
