import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCacheKey,
  buildCacheMeta,
  buildDisabledCacheMeta,
  type CacheRequest,
  deleteCache,
  formatAge,
  getCacheFilePath,
  getWriteErrorCode,
  hasCachedEntry,
  normalizeRequest,
  readCache,
  resolveCacheSettings,
  writeCache,
} from "./cache.js";
import type { FigmaNodesResponse } from "./figma-client.js";

// Windows は POSIX のパーミッションビットを実装しておらず、mode は読み取り専用ビット以外
// 無視される。権限で保護を効かせたり失敗を再現したりするテストは Windows では
// 成立しないため、サポート対象の OS でのみ実行する
const itPosix = it.skipIf(process.platform === "win32");

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

describe("resolveCacheSettings", () => {
  const defaultDir = join(homedir(), ".cache", "figma-reader");

  // CI や開発者の環境に設定されている値に左右されないよう、関係する env をすべて明示する
  function stubCacheEnv({ cache, dir, xdg }: { cache?: string; dir?: string; xdg?: string }) {
    vi.stubEnv("FIGMA_READER_CACHE", cache);
    vi.stubEnv("FIGMA_READER_CACHE_DIR", dir);
    vi.stubEnv("XDG_CACHE_HOME", xdg);
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("保存先の解決", () => {
    it("何も設定されていなければ ~/.cache/figma-reader を返す", () => {
      stubCacheEnv({});
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir: defaultDir });
    });

    it("XDG_CACHE_HOME が絶対パスならそちらを優先する", () => {
      const absolute = join(tmpdir(), "xdg-cache");
      stubCacheEnv({ xdg: absolute });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({
        enabled: true,
        dir: join(absolute, "figma-reader"),
      });
    });

    // 相対パスを採用すると cwd（多くはリポジトリルート）にデザインデータが書き出される
    it.each([".cache", "~/.cache", " "])(
      "XDG_CACHE_HOME が %o なら既定にフォールバックする",
      (value) => {
        stubCacheEnv({ xdg: value });
        expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir: defaultDir });
      },
    );

    it("FIGMA_READER_CACHE_DIR は XDG_CACHE_HOME より優先され、figma-reader/ を付けない", () => {
      const dir = join(tmpdir(), "fr-cache");
      stubCacheEnv({ dir, xdg: join(tmpdir(), "xdg-cache") });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir });
    });

    // 生の値を使うと先頭の空白で join の結果が相対パスに化ける
    it("FIGMA_READER_CACHE_DIR は trim 後の値を使う", () => {
      const dir = join(tmpdir(), "fr-cache");
      stubCacheEnv({ dir: ` ${dir} ` });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir });
    });

    it.each(["", "  "])("FIGMA_READER_CACHE_DIR が %o なら未設定として扱う", (value) => {
      const xdg = join(tmpdir(), "xdg-cache");
      stubCacheEnv({ dir: value, xdg });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({
        enabled: true,
        dir: join(xdg, "figma-reader"),
      });
    });

    // cwd 依存でキャッシュが黙って分裂するのを防ぐ
    it.each(["rel", "./x", "~/x"])("FIGMA_READER_CACHE_DIR が %o ならエラーにする", (value) => {
      stubCacheEnv({ dir: value });
      const error = resolveCacheSettings()._unsafeUnwrapErr();
      expect(error.type).toBe("CUSTOM_ERROR");
      expect(error.type === "CUSTOM_ERROR" && error.message).toContain("FIGMA_READER_CACHE_DIR");
    });
  });

  describe("FIGMA_READER_CACHE の解釈", () => {
    it.each([" On ", "TRUE", "1"])("%o なら有効", (value) => {
      stubCacheEnv({ cache: value });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir: defaultDir });
    });

    it.each(["off", " False ", "0"])("%o なら無効", (value) => {
      stubCacheEnv({ cache: value });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: false });
    });

    // `FIGMA_READER_CACHE=$UNDEFINED` で空文字が渡るスクリプトを壊さない
    it.each([undefined, "", "  "])("%o なら既定の有効として扱う", (value) => {
      stubCacheEnv({ cache: value });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: true, dir: defaultDir });
    });

    // FIGMA_READER_CACHE_DIR との取り違えを検出する
    it.each(["/path/to/dir", "yes"])("%o なら受理値を列挙してエラーにする", (value) => {
      stubCacheEnv({ cache: value });
      const error = resolveCacheSettings()._unsafeUnwrapErr();
      expect(error.type).toBe("CUSTOM_ERROR");
      expect(error.type === "CUSTOM_ERROR" && error.message).toContain(
        "1, true, on, 0, false, off",
      );
    });

    // 使わないパスの妥当性で起動不能にしない
    it("無効時は FIGMA_READER_CACHE_DIR が不正でもエラーにしない", () => {
      stubCacheEnv({ cache: "off", dir: "rel" });
      expect(resolveCacheSettings()._unsafeUnwrap()).toEqual({ enabled: false });
    });
  });
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
  it("<fileKey>/<key>.json に解決する", () => {
    const path = getCacheFilePath(request, "/cache");
    expect(path).toBe(join("/cache", "ABC123", `${buildCacheKey(request)}.json`));
  });

  it("fileKey の英数字以外をディレクトリ名から除去する", () => {
    const path = getCacheFilePath({ ...request, fileKey: "a/b:c" }, "/cache");
    expect(path).toBe(
      join("/cache", "a_b_c", `${buildCacheKey({ ...request, fileKey: "a/b:c" })}.json`),
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

  it("キャッシュが有効であることを示す", () => {
    expect(buildCacheMeta({ hit: true, cached: true, fetchedAt, now }).enabled).toBe(true);
  });

  // sandbox に書き込みを拒否され続けても、原因と回復手段が分からなければ誰も気づけない
  it.each([false, true])(
    "書き込みに失敗したミスの note は原因と回復手段を含む（staleEntryRemains: %o）",
    (staleEntryRemains) => {
      const meta = buildCacheMeta({
        hit: false,
        cached: false,
        staleEntryRemains,
        writeFailure: { code: "EPERM", dir: "/c" },
        fetchedAt,
        now,
      });
      expect(meta.note).toContain("NOT cached");
      expect(meta.note).toContain("EPERM");
      expect(meta.note).toContain("/c");
      expect(meta.note).toContain("FIGMA_READER_CACHE_DIR");
    },
  );

  // 未解決 id のために書き込まなかった場合は、書き込みの失敗ではない
  it("書き込みを試みなかったミスの note は回復手段を含まない", () => {
    const meta = buildCacheMeta({ hit: false, cached: false, fetchedAt, now });
    expect(meta.note).not.toContain("FIGMA_READER_CACHE_DIR");
  });
});

describe("buildDisabledCacheMeta", () => {
  const fetchedAt = "2026-09-20T00:00:00.000Z";

  // 無効と書き込み失敗はどちらも hit:false, cached:false なので enabled で区別させる
  it("無効状態であることを示し、取得時刻をそのまま載せる", () => {
    const meta = buildDisabledCacheMeta({ fetchedAt });
    expect(meta).toMatchObject({
      hit: false,
      cached: false,
      enabled: false,
      fetchedAt,
      ageSeconds: 0,
    });
    expect(meta.note).toContain("FIGMA_READER_CACHE");
  });
});

describe("getWriteErrorCode", () => {
  it("cause の code を返す", () => {
    const cause = Object.assign(new Error("x"), { code: "EPERM" });
    expect(getWriteErrorCode({ type: "CONFIG_WRITE_ERROR", cause })).toBe("EPERM");
  });

  it("Error でなくても code を持つ cause ならその値を返す", () => {
    expect(getWriteErrorCode({ type: "CONFIG_WRITE_ERROR", cause: { code: "EACCES" } })).toBe(
      "EACCES",
    );
  });

  it("code を持たない cause なら unknown を返す", () => {
    expect(getWriteErrorCode({ type: "CONFIG_WRITE_ERROR", cause: new Error("x") })).toBe(
      "unknown",
    );
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
  itPosix("キャッシュファイルを 0600 で作成する", async () => {
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

  it("deleteCache はキャッシュを消し、存在しなくても成功を返す", async () => {
    await writeCache(request, response, fetchedAt, testDir);
    expect((await deleteCache(request, testDir)).isOk()).toBe(true);

    expect(await readCache(request, testDir)).toBeUndefined();
    // 元から無い場合も成功扱い。呼び出し元は「消えている」ことだけを知りたい
    expect((await deleteCache(request, testDir)).isOk()).toBe(true);
  });

  // 失敗を握り潰すと、古いエントリが残ったまま「消えた」と誤報告してしまう
  itPosix("deleteCache は削除できなければエラーを返す", async () => {
    await writeCache(request, response, fetchedAt, testDir);
    const dir = dirname(getCacheFilePath(request, testDir));
    await chmod(dir, 0o500);

    const result = await deleteCache(request, testDir);
    await chmod(dir, 0o700);

    expect(result._unsafeUnwrapErr().type).toBe("CONFIG_WRITE_ERROR");
    expect(await readCache(request, testDir)).toBeDefined();
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
