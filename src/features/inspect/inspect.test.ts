import { afterEach, describe, expect, it, vi } from "vitest";
import { checkStylesConflict, getNodes, parseDepth } from "./inspect.js";

describe("checkStylesConflict", () => {
  it("--styles 単体は通す", () => {
    const result = checkStylesConflict({ styles: true, pretty: false, geometry: false });

    expect(result.isOk()).toBe(true);
  });

  it.each([
    { pretty: true, geometry: false },
    { pretty: false, geometry: true },
    { pretty: true, geometry: true },
  ])("--styles なしなら %o でも通す", (flags) => {
    const result = checkStylesConflict({ styles: false, ...flags });

    expect(result.isOk()).toBe(true);
  });

  it.each([
    [{ styles: true, pretty: true, geometry: false }, "--styles cannot be combined with --pretty"],
    [
      { styles: true, pretty: false, geometry: true },
      "--styles cannot be combined with --geometry",
    ],
    // 両方競合する場合にどちらの名前を出すかは既存の優先順位（--pretty 優先）に従う
    [{ styles: true, pretty: true, geometry: true }, "--styles cannot be combined with --pretty"],
  ])("%o はエラーを返す", (options, message) => {
    expect(checkStylesConflict(options)._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message,
    });
  });
});

describe("parseDepth", () => {
  it("未指定なら undefined を返す", () => {
    expect(parseDepth(undefined)._unsafeUnwrap()).toBeUndefined();
  });

  it.each([
    ["1", 1],
    ["3", 3],
    ["10", 10],
    // parseInt の既存挙動をそのまま維持する（厳密な数値判定には締め直さない）
    ["3abc", 3],
  ])("%o は %o にパースする", (input, expected) => {
    expect(parseDepth(input)._unsafeUnwrap()).toBe(expected);
  });

  it.each(["0", "-1", "abc", ""])("%o はエラーを返す", (input) => {
    expect(parseDepth(input)._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--depth must be a positive integer",
    });
  });
});

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

  it("200 でも nodes を欠くボディは API_ERROR を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ name: "TestFile" }), { status: 200 }),
    );

    const result = await getNodes({
      fileKey: "ABC123",
      nodeId: "1:23",
      token: "test-token",
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    expect(error).toMatchObject({ message: expect.stringContaining("nodes") });
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
