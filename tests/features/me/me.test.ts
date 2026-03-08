import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMe } from "../../../src/features/me/me.js";

describe("getMe", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ユーザー情報を取得できる", async () => {
    const user = {
      id: "123",
      email: "test@example.com",
      handle: "testuser",
      img_url: "https://example.com/avatar.png",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(user),
    });

    const result = await getMe("test-token");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual(user);
  });

  it("API エラー時にエラーを返す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
      headers: new Headers(),
    });

    const result = await getMe("bad-token");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });
});
