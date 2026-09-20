import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCacheFilePath, normalizeRequest } from "../../lib/cache.js";
import {
  checkStylesConflict,
  getNodes,
  getNodesWithCache,
  hasCachedNodes,
  parseDepth,
} from "./inspect.js";

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

describe("getNodesWithCache", () => {
  const cacheDir = join(tmpdir(), `figma-reader-inspect-cache-test-${Date.now()}`);
  const base = { fileKey: "ABC123", nodeId: "1:23", token: "test-token", refresh: false, cacheDir };

  // mockResolvedValue だと同一 Response を使い回して body が二度読めなくなるため、
  // 呼び出しごとに新しい Response を返す
  function mockFetch(body: unknown, status = 200) {
    return vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  const okBody = { name: "TestFile", nodes: { "1:23": { document: { id: "1:23" } } } };

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("2 回目は API を呼ばずキャッシュから返す", async () => {
    const spy = mockFetch(okBody);

    const first = await getNodesWithCache(base);
    expect(first._unsafeUnwrap().meta.hit).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await getNodesWithCache(base);
    expect(spy).toHaveBeenCalledTimes(1);
    const value = second._unsafeUnwrap();
    expect(value.meta.hit).toBe(true);
    expect(value.response).toEqual(first._unsafeUnwrap().response);
  });

  it("refresh 指定時は毎回 API を呼びキャッシュを更新する", async () => {
    const spy = mockFetch(okBody);
    await getNodesWithCache(base);

    const refreshed = await getNodesWithCache({ ...base, refresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(refreshed._unsafeUnwrap().meta.hit).toBe(false);

    // 更新後も通常呼び出しはヒットする
    await getNodesWithCache(base);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["depth", { depth: 2 }],
    ["geometry", { geometry: true }],
    ["node-id", { nodeId: "1:23,4:56" }],
  ])("%s が違えば互いのキャッシュにヒットしない", async (_label, override) => {
    const spy = mockFetch(okBody);

    await getNodesWithCache(base);
    const other = await getNodesWithCache({ ...base, ...override });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(other._unsafeUnwrap().meta.hit).toBe(false);
  });

  it("キャッシュが壊れていればエラーにせず API 取得へフォールバックする", async () => {
    const spy = mockFetch(okBody);
    const filePath = getCacheFilePath(normalizeRequest(base), cacheDir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ broken", "utf-8");

    const result = await getNodesWithCache(base);

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().meta.hit).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 解決できない node-id を保存すると TTL が無いため永久に固定される
  it("nodes に null を含むレスポンスはキャッシュしない", async () => {
    const spy = mockFetch({ name: "TestFile", nodes: { "1:23": null } });

    await getNodesWithCache(base);
    await getNodesWithCache(base);

    expect(spy).toHaveBeenCalledTimes(2);
    await expect(stat(getCacheFilePath(normalizeRequest(base), cacheDir))).rejects.toThrow();
  });

  // 解決できない id はキーごと欠けることもあるため、null の有無だけでは足りない
  it("要求した node-id がレスポンスに欠けていればキャッシュしない", async () => {
    const spy = mockFetch({ name: "TestFile", nodes: {} });

    const result = await getNodesWithCache(base);
    await getNodesWithCache(base);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(result._unsafeUnwrap().meta.note).toContain("NOT cached");
    await expect(stat(getCacheFilePath(normalizeRequest(base), cacheDir))).rejects.toThrow();
  });

  // 削除されたノードを --refresh で確認したのに、次の通常呼び出しが削除前の
  // デザインを hit として返してしまうのを防ぐ
  it("refresh で未解決だった場合は既存のキャッシュを破棄する", async () => {
    mockFetch(okBody);
    await getNodesWithCache(base);
    expect(await hasCachedNodes(base)).toBe(true);

    mockFetch({ name: "TestFile", nodes: { "1:23": null } });
    await getNodesWithCache({ ...base, refresh: true });

    expect(await hasCachedNodes(base)).toBe(false);
  });

  // 送信 id と判定 id が別の値から導出されていると、空白混じりの入力で
  // 正常なレスポンスが恒久的に「未解決」になる
  it("API へは正規化済みの node-id を送る", async () => {
    const spy = mockFetch({ name: "TestFile", nodes: { "1:23": {}, "4:56": {} } });

    await getNodesWithCache({ ...base, nodeId: "4:56, 1:23,1:23" });

    const url = spy.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(url)).toContain("ids=1:23,4:56");
  });

  // writeCache は tmp -> rename で書くため、失敗すると既存ファイルが手つかずで残る。
  // 取り直した直後に古いデザインが hit として返る状態遷移を塞ぐ
  it("refresh の書き込みが失敗したら古いエントリを残さない", async () => {
    mockFetch(okBody);
    await getNodesWithCache(base);
    expect(await hasCachedNodes(base)).toBe(true);

    // 一時ファイルのパスをディレクトリで塞ぎ、writeCache だけを失敗させる。
    // 保存先ディレクトリは書けるままなので、古いエントリは消せる状態に保つ
    const filePath = getCacheFilePath(normalizeRequest(base), cacheDir);
    await mkdir(`${filePath}.${process.pid}.tmp`, { recursive: true });

    const result = await getNodesWithCache({ ...base, refresh: true });

    expect(result._unsafeUnwrap().cacheWriteFailed).toBe(true);
    expect(await hasCachedNodes(base)).toBe(false);
  });

  it("保存も破棄もできなければ staleEntryRemains を立てて note で警告する", async () => {
    mockFetch(okBody);
    await getNodesWithCache(base);

    // ディレクトリごと読み書き不可にして writeCache も deleteCache も失敗させる
    const dir = dirname(getCacheFilePath(normalizeRequest(base), cacheDir));
    await chmod(dir, 0o500);

    const result = await getNodesWithCache({ ...base, refresh: true });
    await chmod(dir, 0o700);

    const value = result._unsafeUnwrap();
    expect(value.staleEntryRemains).toBe(true);
    expect(value.meta.cached).toBe(false);
    expect(value.meta.note).toContain("stale");
    // 古いエントリは実際に残っている
    expect(await hasCachedNodes(base)).toBe(true);
  });

  it("API エラー時はキャッシュを作らない", async () => {
    mockFetch({ message: "Not Found" }, 404);

    const result = await getNodesWithCache(base);

    expect(result.isErr()).toBe(true);
    await expect(stat(getCacheFilePath(normalizeRequest(base), cacheDir))).rejects.toThrow();
  });

  it("hasCachedNodes は getNodesWithCache と同じキーでキャッシュの有無を判定する", async () => {
    mockFetch(okBody);
    expect(await hasCachedNodes(base)).toBe(false);

    await getNodesWithCache(base);

    expect(await hasCachedNodes(base)).toBe(true);
    // 条件が違えば別のキャッシュなので存在しない
    expect(await hasCachedNodes({ ...base, depth: 2 })).toBe(false);
  });

  it("キャッシュを書けなくてもコマンドは成功し cacheWriteFailed を立てる", async () => {
    mockFetch(okBody);
    await mkdir(cacheDir, { recursive: true });
    const blocked = join(cacheDir, "blocked");
    await writeFile(blocked, "", "utf-8");

    const result = await getNodesWithCache({ ...base, cacheDir: blocked });

    const value = result._unsafeUnwrap();
    expect(value.cacheWriteFailed).toBe(true);
    expect(value.meta.hit).toBe(false);
    expect(value.response.name).toBe("TestFile");
    // stdout の JSON だけを読むエージェントにも保存失敗が伝わる必要がある
    expect(value.meta.note).toContain("NOT cached");
  });
});
