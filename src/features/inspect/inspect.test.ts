import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  getCacheFilePath,
  normalizeRequest,
  sanitizeFileKey,
} from "../../lib/cache.js";
import {
  buildOutputFileName,
  buildOutputWriteHint,
  checkOutputOption,
  checkStylesConflict,
  getNodes,
  getNodesWithCache,
  hasCachedNodes,
  parseDepth,
  prepareOutputFile,
  writeOutputFile,
} from "./inspect.js";

// Windows は POSIX のパーミッションビットを実装しておらず、chmod で書き込み不可にしても
// 実際には失敗しない。権限で失敗を再現するテストは Windows では成立しないため、
// サポート対象の OS でのみ実行する
const itPosix = it.skipIf(process.platform === "win32");

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

  // 複数 URL 対応の要。ノードごとに呼ぶとレートリミットをその数だけ消費するため、
  // 結合した node-id が 1 リクエストにまとまることを固定する
  it("複数ノードを 1 回のリクエストにまとめる", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ nodes: {} }), { status: 200 }));

    await getNodes({
      fileKey: "ABC123",
      nodeId: "1:2,10:99",
      token: "test-token",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(decodeURIComponent(calledUrl)).toContain("ids=1:2,10:99");
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
  const base = {
    fileKey: "ABC123",
    nodeId: "1:23",
    token: "test-token",
    refresh: false,
    cache: { enabled: true, dir: cacheDir } as const,
  };

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

    expect(result._unsafeUnwrap().writeFailure?.dir).toBe(cacheDir);
    expect(await hasCachedNodes(base)).toBe(false);
  });

  itPosix("保存も破棄もできなければ staleEntryRemains を立てて note で警告する", async () => {
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
    // 書き込みと削除の失敗が重なっても、書き込み失敗の原因と回復手段は伝える
    expect(value.writeFailure?.dir).toBe(cacheDir);
    expect(value.meta.note).toContain("FIGMA_READER_CACHE_DIR");
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

  it("キャッシュを書けなくてもコマンドは成功し writeFailure に原因と書き込み先を載せる", async () => {
    mockFetch(okBody);
    await mkdir(cacheDir, { recursive: true });
    const blocked = join(cacheDir, "blocked");
    await writeFile(blocked, "", "utf-8");

    const result = await getNodesWithCache({ ...base, cache: { enabled: true, dir: blocked } });

    const value = result._unsafeUnwrap();
    expect(value.writeFailure?.dir).toBe(blocked);
    expect(value.writeFailure?.code).toEqual(expect.any(String));
    expect(value.writeFailure?.code).not.toBe("unknown");
    expect(value.meta.hit).toBe(false);
    expect(value.response.name).toBe("TestFile");
    // stdout の JSON だけを読むエージェントにも保存失敗とその書き込み先が伝わる必要がある
    expect(value.meta.note).toContain("NOT cached");
    expect(value.meta.note).toContain(blocked);
  });

  describe("キャッシュ無効", () => {
    let tmp: string;

    afterEach(async () => {
      vi.unstubAllEnvs();
      // mkdtemp より前で失敗したときに、rm の TypeError で本来の失敗を覆わない
      if (tmp) {
        await rm(tmp, { recursive: true, force: true });
      }
    });

    // 無効化をナイーブに「保存しない」と実装すると、保存しなかった場合の deleteCache に
    // 落ちて既存キャッシュが消える。既定の解決先も tmp 配下へ向けておくことで、
    // 実装が誤って既定のパスを組み立てて触った場合にもこのテストで検出できるようにする
    it("API を毎回呼び、既存のキャッシュファイルを読みも消しもしない", async () => {
      tmp = await mkdtemp(join(tmpdir(), "figma-reader-cache-off-"));
      vi.stubEnv("XDG_CACHE_HOME", tmp);
      const enabled = { enabled: true, dir: join(tmp, "figma-reader") } as const;
      const input = { fileKey: "ABC123", nodeId: "1:23", token: "test-token", refresh: false };

      const spy = mockFetch(okBody);
      await getNodesWithCache({ ...input, cache: enabled });
      const filePath = getCacheFilePath(normalizeRequest(input), enabled.dir);
      const before = await readFile(filePath, "utf-8");
      spy.mockClear();

      const disabled = { ...input, cache: { enabled: false } as const };
      const first = await getNodesWithCache(disabled);
      // --refresh は無効時は no-op。エラーにせず普通に取得する
      const second = await getNodesWithCache({ ...disabled, refresh: true });

      expect(spy).toHaveBeenCalledTimes(2);
      for (const result of [first, second]) {
        const value = result._unsafeUnwrap();
        expect(value.meta.enabled).toBe(false);
        expect(value.meta.hit).toBe(false);
        expect(Number.isFinite(Date.parse(value.meta.fetchedAt))).toBe(true);
        expect(value.writeFailure).toBeUndefined();
        expect(value.staleEntryRemains).toBe(false);
      }
      expect(await readFile(filePath, "utf-8")).toBe(before);
      // --refresh 失敗時の案内でもディスクを読まない
      expect(await hasCachedNodes(disabled)).toBe(false);
    });
  });
});

describe("checkOutputOption", () => {
  it("--output 未指定なら --pretty があっても通す", () => {
    expect(checkOutputOption({ output: undefined, pretty: true }).isOk()).toBe(true);
  });

  it("ディレクトリが指定され --pretty がなければ通す", () => {
    expect(checkOutputOption({ output: "./out", pretty: false }).isOk()).toBe(true);
  });

  it("--pretty との併用はエラーを返す", () => {
    expect(checkOutputOption({ output: "./out", pretty: true })._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--output cannot be combined with --pretty",
    });
  });

  // citty は値なしの --output を ""、`--no-output` を false にし、後続のフラグも値として吸い込む
  // （`--output --pretty` は output:"--pretty", pretty:false で届く）。pretty:false でも値の検査で捕まえる
  it.each(["", "   ", "--pretty", "-x", " --styles", false])(
    "%o はディレクトリなしとしてエラーを返す",
    (output) => {
      expect(checkOutputOption({ output, pretty: false })._unsafeUnwrapErr()).toEqual({
        type: "CUSTOM_ERROR",
        message: "--output requires a directory",
      });
    },
  );

  // 引用符で囲まれた ~ はシェルが展開せず、通すと cwd に `~` というディレクトリが作られる
  it.each(["~/figma-out", "~", " ~/x"])("%o は ~ を展開しない旨のエラーを返す", (output) => {
    const error = checkOutputOption({ output, pretty: false })._unsafeUnwrapErr();

    expect(error.type === "CUSTOM_ERROR" && error.message).toContain(
      '--output does not expand "~"',
    );
  });

  // ファイル名を渡す誤用を通すと `design.json/` というディレクトリが黙って作られる
  it.each(["design.json", "out/OUT.JSON"])("%o はファイル名としてエラーを返す", (output) => {
    const error = checkOutputOption({ output, pretty: false })._unsafeUnwrapErr();

    expect(error.type).toBe("CUSTOM_ERROR");
    expect(error.type === "CUSTOM_ERROR" && error.message).toContain(
      "--output takes a directory, not a file name",
    );
  });
});

describe("buildOutputFileName", () => {
  const request = { fileKey: "ABC123", nodeIds: ["1:2"], depth: null, geometry: false };

  it("1 ノードなら <fileKey>_<id>_<hash>.json にする", () => {
    expect(buildOutputFileName(request, false)).toBe(`ABC123_1-2_${buildCacheKey(request)}.json`);
  });

  it("複数ノードなら辞書順の先頭 id に残り個数を付ける", () => {
    const multi = normalizeRequest({ fileKey: "ABC123", nodeId: "1:2,10:99,5:6" });

    // 辞書順なので "10:99" が "1:2" より先に来る。URL の指定順ではない
    expect(buildOutputFileName(multi, false)).toBe(`ABC123_10-99+2_${buildCacheKey(multi)}.json`);
  });

  it("--styles なら _styles を付ける", () => {
    expect(buildOutputFileName(request, true)).toBe(
      `ABC123_1-2_${buildCacheKey(request)}_styles.json`,
    );
  });

  // --depth / --geometry はキャッシュキーに含まれるため、ハッシュ部分で区別される
  it("--depth / --geometry が違えば別の名前になる", () => {
    const names = new Set([
      buildOutputFileName(request, false),
      buildOutputFileName({ ...request, depth: 2 }, false),
      buildOutputFileName({ ...request, geometry: true }, false),
    ]);

    expect(names.size).toBe(3);
  });

  it("インスタンス id の : と ; を - に置換する", () => {
    const instance = { ...request, nodeIds: ["I1:2;3:4"] };

    expect(buildOutputFileName(instance, false)).toBe(
      `ABC123_I1-2-3-4_${buildCacheKey(instance)}.json`,
    );
  });

  // 深い入れ子インスタンスの id で NAME_MAX を超えないよう切り詰める。一意性はハッシュが担う
  it("32 文字を超える id は 32 文字に切り詰める", () => {
    const longId = Array.from({ length: 20 }, (_, i) => `${i}:${i}`).join(";");
    const deep = { ...request, nodeIds: [`I${longId}`] };
    const idPart = buildOutputFileName(deep, false).split("_")[1];

    expect(idPart).toHaveLength(32);
  });

  it("fileKey の禁止文字は sanitizeFileKey どおり置換する", () => {
    const odd = { ...request, fileKey: "a/b:c" };

    expect(buildOutputFileName(odd, false).startsWith(`${sanitizeFileKey("a/b:c")}_`)).toBe(true);
  });
});

describe("buildOutputWriteHint", () => {
  // 取得は済んでいるので、再実行が API を消費するかどうかを取り違えると
  // レートリミットを不意に消費させるか、無料の再実行をためらわせる
  const hint = (cached: boolean, refresh: boolean, staleEntryRemains = false) =>
    buildOutputWriteHint({ cached, refresh, staleEntryRemains });

  // 「再実行は有料」とだけ言うと、--refresh なしの再実行が古い応答を無料で返すことが伝わらない
  it("--refresh 付きで古いエントリが残っていれば、--refresh なしの再実行が古い応答を返すと伝える", () => {
    expect(hint(false, true, true)).toContain("stale");
  });

  // --refresh なしでこの状態になるのは古いエントリを読めなかった場合だけ。再実行しても API を呼ぶ
  it("--refresh なしで古いエントリが残っていても、再実行はリクエストを消費すると伝える", () => {
    const text = hint(false, false, true);

    expect(text).toContain("will spend another API request");
    expect(text).not.toContain("stale");
  });

  it("キャッシュされていなければ、再実行がリクエストを消費すると伝える", () => {
    for (const text of [hint(false, false), hint(false, true)]) {
      expect(text).toContain("will spend another API request");
      expect(text).not.toContain("stale");
    }
  });

  it("キャッシュ済みで --refresh 付きなら、--refresh を外すよう伝える", () => {
    expect(hint(true, true)).toContain("Re-run without --refresh");
  });

  it("キャッシュ済みで --refresh なしなら、再実行はリクエストを消費しないと伝える", () => {
    expect(hint(true, false)).toContain("will not spend an API request");
    expect(hint(true, false)).not.toContain("--refresh");
  });

  it("どの分岐でも --output での再実行を促す", () => {
    for (const text of [
      hint(false, true, true),
      hint(false, false),
      hint(true, true),
      hint(true, false),
    ]) {
      expect(text).toContain("--output");
    }
  });
});

describe("--output のファイル操作 (実ファイル I/O)", () => {
  const request = { fileKey: "ABC123", nodeIds: ["1:2"], depth: null, geometry: false };
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "figma-reader-output-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("prepareOutputFile", () => {
    it("存在しない入れ子のディレクトリを作り、命名規則どおりの絶対パスを返す", async () => {
      const result = await prepareOutputFile({
        dir: join(testDir, "a", "b"),
        request,
        styles: false,
        cwd: "/somewhere/else",
      });

      const filePath = join(testDir, "a", "b", buildOutputFileName(request, false));
      expect(result._unsafeUnwrap()).toBe(filePath);
      expect((await stat(join(testDir, "a", "b"))).isDirectory()).toBe(true);
      // 試し書きの一時ファイルも、本体のファイルも残さない
      await expect(stat(`${filePath}.${process.pid}.tmp`)).rejects.toThrow();
      await expect(stat(filePath)).rejects.toThrow();
    });

    it("相対ディレクトリは cwd 基準で解決する", async () => {
      const result = await prepareOutputFile({ dir: "out", request, styles: true, cwd: testDir });

      expect(result._unsafeUnwrap()).toBe(join(testDir, "out", buildOutputFileName(request, true)));
    });

    it("既存の通常ファイルを渡すとエラーを返す", async () => {
      await writeFile(join(testDir, "file"), "x");

      const result = await prepareOutputFile({ dir: "file", request, styles: false, cwd: testDir });

      const error = result._unsafeUnwrapErr();
      expect(error.type === "CUSTOM_ERROR" && error.message).toContain(
        `Failed to create the --output directory ${join(testDir, "file")}`,
      );
    });

    // mkdir は既存ディレクトリなら書けなくても成功する。試し書きで API 前に止める
    itPosix("書き込めない既存ディレクトリならエラーを返し、一時ファイルを残さない", async () => {
      const dir = join(testDir, "readonly");
      await mkdir(dir);
      await chmod(dir, 0o500);

      const result = await prepareOutputFile({ dir, request, styles: false, cwd: testDir });
      await chmod(dir, 0o700);

      const filePath = join(dir, buildOutputFileName(request, false));
      expect(result._unsafeUnwrapErr()).toEqual({
        type: "CUSTOM_ERROR",
        message: `Cannot write to ${filePath} (EACCES); no API request was made`,
      });
      await expect(stat(`${filePath}.${process.pid}.tmp`)).rejects.toThrow();
    });
  });

  describe("writeOutputFile", () => {
    it("渡した文字列をそのまま書き、一時ファイルを残さない", async () => {
      const filePath = join(testDir, "design.json");
      const content = '{"a":1}\n';

      expect((await writeOutputFile(filePath, content)).isOk()).toBe(true);
      expect(await readFile(filePath, "utf-8")).toBe(content);
      await expect(stat(`${filePath}.${process.pid}.tmp`)).rejects.toThrow();
    });

    it("既存ファイルを上書きする", async () => {
      const filePath = join(testDir, "design.json");
      await writeFile(filePath, "old");

      await writeOutputFile(filePath, "new");

      expect(await readFile(filePath, "utf-8")).toBe("new");
    });

    // 直接上書きしないので、書き込みに失敗しても既存の正常なファイルは壊れない
    itPosix("書き込めなければ、更新されていない旨のエラーを返し既存ファイルを残す", async () => {
      const dir = join(testDir, "readonly");
      await mkdir(dir);
      const filePath = join(dir, "design.json");
      await writeFile(filePath, "old");
      await chmod(dir, 0o500);

      const result = await writeOutputFile(filePath, "new");
      await chmod(dir, 0o700);

      expect(result._unsafeUnwrapErr()).toEqual({
        type: "CUSTOM_ERROR",
        message: `Failed to write the --output file ${filePath} (EACCES); any existing file at that path was not updated`,
      });
      expect(await readFile(filePath, "utf-8")).toBe("old");
      await expect(stat(`${filePath}.${process.pid}.tmp`)).rejects.toThrow();
    });
  });
});
