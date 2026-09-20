import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  buildCacheMeta,
  type CacheRequest,
  deleteCache,
  formatAge,
  getCacheDir,
  getCacheFilePath,
  hasCachedEntry,
  normalizeRequest,
  readCache,
  writeCache,
} from "./cache.js";
import type { FigmaNodesResponse } from "./figma-client.js";

const request: CacheRequest = {
  fileKey: "ABC123",
  nodeIds: ["1:2"],
  depth: null,
  geometry: false,
};

const response = {
  name: "TestFile",
  role: "owner",
  lastModified: "2026-03-01T12:00:00Z",
  editorType: "figma",
  thumbnailUrl: "",
  err: null,
  nodes: {},
} satisfies FigmaNodesResponse;

describe("getCacheDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("XDG_CACHE_HOME 未設定なら ~/.cache/figma-reader を返す", () => {
    vi.stubEnv("XDG_CACHE_HOME", undefined);
    expect(getCacheDir()).toBe(join(homedir(), ".cache", "figma-reader"));
  });

  it("XDG_CACHE_HOME が絶対パスならそちらを優先する", () => {
    const absolute = join(tmpdir(), "xdg-cache");
    vi.stubEnv("XDG_CACHE_HOME", absolute);
    expect(getCacheDir()).toBe(join(absolute, "figma-reader"));
  });

  // 相対パスを採用すると cwd（多くはリポジトリルート）にデザインデータが書き出される
  it.each([".cache", "~/.cache", " "])(
    "XDG_CACHE_HOME が %o なら既定にフォールバックする",
    (value) => {
      vi.stubEnv("XDG_CACHE_HOME", value);
      const result = getCacheDir();
      expect(result).toBe(join(homedir(), ".cache", "figma-reader"));
      expect(isAbsolute(result)).toBe(true);
    },
  );
});

describe("normalizeRequest", () => {
  // 並びは辞書順で、数値順ではない。キーを正準化できれば十分なため
  it("カンマ区切りの node-id を分割し、空白を除去してソートする", () => {
    expect(normalizeRequest({ fileKey: "K", nodeId: "1:2, 10:99" })).toEqual({
      fileKey: "K",
      nodeIds: ["10:99", "1:2"],
      depth: null,
      geometry: false,
    });
  });

  it("重複した node-id を除去する", () => {
    expect(normalizeRequest({ fileKey: "K", nodeId: "1:2,1:2" }).nodeIds).toEqual(["1:2"]);
  });

  it("空要素を除去する", () => {
    expect(normalizeRequest({ fileKey: "K", nodeId: "1:2,,3:4," }).nodeIds).toEqual(["1:2", "3:4"]);
  });

  it("depth 未指定は null、geometry 未指定は false になる", () => {
    const result = normalizeRequest({ fileKey: "K", nodeId: "1:2" });
    expect(result.depth).toBeNull();
    expect(result.geometry).toBe(false);
  });
});

describe("buildCacheKey", () => {
  it("node-id の指定順が違っても同じキーになる", () => {
    const a = normalizeRequest({ fileKey: "K", nodeId: "1:2,10:99" });
    const b = normalizeRequest({ fileKey: "K", nodeId: "10:99,1:2" });
    expect(buildCacheKey(a)).toBe(buildCacheKey(b));
  });

  it.each([
    ["depth", { fileKey: "K", nodeId: "1:2", depth: 2 }],
    ["geometry", { fileKey: "K", nodeId: "1:2", geometry: true }],
    ["fileKey", { fileKey: "OTHER", nodeId: "1:2" }],
    ["node-id", { fileKey: "K", nodeId: "1:2,3:4" }],
  ])("%s が違えば別のキーになる", (_label, input) => {
    const base = buildCacheKey(normalizeRequest({ fileKey: "K", nodeId: "1:2" }));
    expect(buildCacheKey(normalizeRequest(input))).not.toBe(base);
  });
});

describe("getCacheFilePath", () => {
  it("v1/<fileKey>/<key>.json に解決する", () => {
    const path = getCacheFilePath(request, "/cache");
    expect(path).toBe(join("/cache", "v1", "ABC123", `${buildCacheKey(request)}.json`));
  });

  it("fileKey の英数字以外をディレクトリ名から除去する", () => {
    const path = getCacheFilePath({ ...request, fileKey: "a/b:c" }, "/cache");
    expect(path).toBe(
      join("/cache", "v1", "a_b_c", `${buildCacheKey({ ...request, fileKey: "a/b:c" })}.json`),
    );
  });
});

describe("formatAge", () => {
  it.each([
    [0, "0s"],
    [59, "59s"],
    [60, "1m"],
    [3599, "59m"],
    [3600, "1h"],
    [86399, "23h"],
    [86400, "1d"],
    [8 * 86400, "8d"],
  ])("%o 秒は %o になる", (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected);
  });
});

describe("buildCacheMeta", () => {
  const fetchedAt = "2026-09-20T00:00:00.000Z";
  const now = Date.parse(fetchedAt);

  it("経過秒数を算出する", () => {
    const meta = buildCacheMeta({ hit: true, cached: true, fetchedAt, now: now + 3600_000 });
    expect(meta.ageSeconds).toBe(3600);
  });

  // 時計の巻き戻しで負値になると「fetched -3h ago」のような出力になる
  it("取得時刻が未来でも ageSeconds は 0 を下回らない", () => {
    const meta = buildCacheMeta({ hit: true, cached: true, fetchedAt, now: now - 3600_000 });
    expect(meta.ageSeconds).toBe(0);
  });

  it("ヒット時の note は古さと --refresh の案内を含む", () => {
    const meta = buildCacheMeta({ hit: true, cached: true, fetchedAt, now: now + 3600_000 });
    expect(meta.hit).toBe(true);
    expect(meta.note).toContain("1h ago");
    expect(meta.note).toContain("--refresh");
  });

  it("ミス時の note は API 取得である旨を示す", () => {
    const meta = buildCacheMeta({ hit: false, cached: true, fetchedAt, now });
    expect(meta.hit).toBe(false);
    expect(meta.note).not.toContain("--refresh");
    expect(meta.note).toContain("cached locally");
  });

  // 保存できなかったことを黙っていると「次回は無料」と誤解される
  it("保存できなかったミスの note はキャッシュされていないと明示する", () => {
    const meta = buildCacheMeta({ hit: false, cached: false, fetchedAt, now });
    expect(meta.cached).toBe(false);
    expect(meta.note).toContain("NOT cached");
  });

  it("cached をそのまま出力に載せる", () => {
    expect(buildCacheMeta({ hit: true, cached: true, fetchedAt, now }).cached).toBe(true);
    expect(buildCacheMeta({ hit: false, cached: true, fetchedAt, now }).cached).toBe(true);
  });
});

describe("readCache / writeCache / hasCachedEntry (実ファイル I/O)", () => {
  const testDir = join(tmpdir(), `figma-reader-cache-test-${Date.now()}`);
  const fetchedAt = "2026-09-20T00:00:00.000Z";

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("書き込んだキャッシュを読み戻せる", async () => {
    expect((await writeCache(request, response, fetchedAt, testDir)).isOk()).toBe(true);

    const entry = await readCache(request, testDir);
    expect(entry).toEqual({ fetchedAt, request, response });
    expect(await hasCachedEntry(request, testDir)).toBe(true);
  });

  it("ディレクトリを自動作成し、一時ファイルを残さない", async () => {
    await writeCache(request, response, fetchedAt, testDir);

    const filePath = getCacheFilePath(request, testDir);
    await expect(readFile(filePath, "utf-8")).resolves.toContain("TestFile");
    await expect(stat(`${filePath}.${process.pid}.tmp`)).rejects.toThrow();
  });

  // 中身は未公開のデザインデータなので同一マシンの他ユーザーから読めてはいけない
  it("キャッシュファイルを 0600 で作成する", async () => {
    await writeCache(request, response, fetchedAt, testDir);

    const { mode } = await stat(getCacheFilePath(request, testDir));
    expect(mode & 0o777).toBe(0o600);
  });

  it("ファイルが存在しなければ undefined を返す", async () => {
    expect(await readCache(request, testDir)).toBeUndefined();
    expect(await hasCachedEntry(request, testDir)).toBe(false);
  });

  it("壊れた JSON は undefined を返す", async () => {
    const filePath = getCacheFilePath(request, testDir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ not json", "utf-8");

    expect(await readCache(request, testDir)).toBeUndefined();
  });

  // ハッシュの切り詰めによる衝突や大小文字非依存 FS でのディレクトリ共有を想定
  it("中身の request が要求と食い違えば undefined を返す", async () => {
    const filePath = getCacheFilePath(request, testDir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ fetchedAt, request: { ...request, depth: 3 }, response }),
      "utf-8",
    );

    expect(await readCache(request, testDir)).toBeUndefined();
  });

  it("fetchedAt が不正なら undefined を返す", async () => {
    const filePath = getCacheFilePath(request, testDir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      JSON.stringify({ fetchedAt: "not-a-date", request, response }),
      "utf-8",
    );

    expect(await readCache(request, testDir)).toBeUndefined();
  });

  // response 欠けを素通しすると、既定出力は `{"_cache":...}` だけを exit 0 で吐き、
  // --styles / --pretty は素の TypeError で落ちる
  it.each([
    ["response 欠け", { fetchedAt: "2026-09-20T00:00:00.000Z", request }],
    ["response が非オブジェクト", { fetchedAt: "2026-09-20T00:00:00.000Z", request, response: 1 }],
    ["nodes 欠け", { fetchedAt: "2026-09-20T00:00:00.000Z", request, response: { name: "x" } }],
  ])("%s なら undefined を返す", async (_label, entry) => {
    const filePath = getCacheFilePath(request, testDir);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(entry), "utf-8");

    expect(await readCache(request, testDir)).toBeUndefined();
  });

  it("deleteCache はキャッシュを消し、存在しなくても失敗しない", async () => {
    await writeCache(request, response, fetchedAt, testDir);
    await deleteCache(request, testDir);

    expect(await readCache(request, testDir)).toBeUndefined();
    await expect(deleteCache(request, testDir)).resolves.toBeUndefined();
  });

  // キャッシュは最適化なので、どんな I/O エラーでもミス扱いに落ちなければならない
  it("cacheDir が通常ファイルでも例外を投げずに undefined を返す", async () => {
    await mkdir(testDir, { recursive: true });
    const notADir = join(testDir, "blocked");
    await writeFile(notADir, "", "utf-8");

    expect(await readCache(request, notADir)).toBeUndefined();
    expect((await writeCache(request, response, fetchedAt, notADir))._unsafeUnwrapErr().type).toBe(
      "CONFIG_WRITE_ERROR",
    );
  });
});
