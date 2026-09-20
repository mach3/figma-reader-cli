import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "./error.js";
import type { FigmaNodesResponse } from "./figma-client.js";

/** キャッシュヒットの古さがこの秒数を超えたら警告する（7 日） */
export const STALE_WARNING_SECONDS = 7 * 24 * 60 * 60;

/** レスポンスの内容を決定する要素。これが一致するリクエストは同じキャッシュを共有する */
export type CacheRequest = {
  fileKey: string;
  nodeIds: string[];
  depth: number | null;
  geometry: boolean;
};

/** キャッシュファイルの中身 */
export type CacheEntry = {
  fetchedAt: string;
  request: CacheRequest;
  response: FigmaNodesResponse;
};

/** 出力に添える取得元と鮮度の情報 */
export type CacheMeta = {
  hit: boolean;
  /** このレスポンスがディスク上のキャッシュに存在するか。false なら同じ要求が再び API を消費する */
  cached: boolean;
  fetchedAt: string;
  ageSeconds: number;
  note: string;
};

export type NormalizeRequestInput = {
  fileKey: string;
  /** parseFigmaUrl の戻り値。カンマ区切りで複数の node-id を含みうる */
  nodeId: string;
  depth?: number;
  geometry?: boolean;
};

/**
 * CLI 引数由来の値を CacheRequest に正規化する（純粋関数）。
 * node-id は重複除去とソートを行う。レスポンスの nodes は id をキーとする
 * オブジェクトで順序に意味がないため、`1:2,10:99` と `10:99,1:2` を
 * 同じキャッシュに畳んでよい
 */
export function normalizeRequest({
  fileKey,
  nodeId,
  depth,
  geometry,
}: NormalizeRequestInput): CacheRequest {
  const nodeIds = [...new Set(nodeId.split(",").map((id) => id.trim()))]
    .filter((id) => id !== "")
    .sort();
  return { fileKey, nodeIds, depth: depth ?? null, geometry: Boolean(geometry) };
}

/**
 * キャッシュのルートディレクトリを返す。
 * XDG_CACHE_HOME は**絶対パスのときだけ**採用する。XDG Base Directory 仕様が
 * 相対パスを無効と定めており、`XDG_CACHE_HOME=.cache` のような設定を
 * そのまま使うとキャッシュが cwd（多くはリポジトリルート）に書き出され、
 * デザインデータがリポジトリへ漏れるため
 */
export function getCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME?.trim();
  if (xdg && isAbsolute(xdg)) {
    return join(xdg, "figma-reader");
  }
  return join(homedir(), ".cache", "figma-reader");
}

/** CacheRequest からキャッシュファイル名に使うキーを導出する */
export function buildCacheKey(request: CacheRequest): string {
  const source = JSON.stringify([
    request.fileKey,
    request.nodeIds,
    request.depth,
    request.geometry,
  ]);
  return createHash("sha256").update(source).digest("hex").slice(0, 16);
}

/**
 * fileKey をディレクトリ名として安全な形に落とす。
 * Figma の fileKey は英数字だが、URL から素で取り出した値なので
 * パス区切りや Windows の禁止文字が混ざる可能性を潰しておく。
 * 衝突しても readCache の request 照合で弾けるため、可逆である必要はない
 */
function sanitizeFileKey(fileKey: string): string {
  return fileKey.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** キャッシュファイルの絶対パスを返す。cacheDir はテスト用に差し替え可能 */
export function getCacheFilePath(request: CacheRequest, cacheDir = getCacheDir()): string {
  return join(cacheDir, "v1", sanitizeFileKey(request.fileKey), `${buildCacheKey(request)}.json`);
}

/**
 * キャッシュを読む。**あらゆる失敗で undefined を返す**。
 * キャッシュは最適化であり、読めないことが inspect の失敗になってはならないため、
 * ENOENT だけでなく EACCES・ENOTDIR・JSON パース失敗もすべてミス扱いにする
 */
export async function readCache(
  request: CacheRequest,
  cacheDir = getCacheDir(),
): Promise<CacheEntry | undefined> {
  try {
    const content = await readFile(getCacheFilePath(request, cacheDir), "utf-8");
    const entry = JSON.parse(content) as CacheEntry;

    // ハッシュの切り詰めによる衝突や、大小文字非依存 FS でのディレクトリ共有で
    // 別リクエストのファイルを掴む可能性があるため、中身の request を照合する
    if (!isSameRequest(entry.request, request)) {
      return undefined;
    }
    // 壊れた fetchedAt は ageSeconds を NaN にし、JSON では null に化ける
    if (!Number.isFinite(Date.parse(entry.fetchedAt))) {
      return undefined;
    }
    // response を欠くファイルをそのまま返すと、既定の出力は `{"_cache":...}` だけを
    // exit 0 で吐き（エージェントは「ノードが無い」と読む）、--styles と --pretty は
    // 素の TypeError で落ちる。どちらも機械可読なエラーを返す方針に反する
    if (typeof entry.response !== "object" || entry.response === null) {
      return undefined;
    }
    if (typeof entry.response.nodes !== "object" || entry.response.nodes === null) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
}

/** キャッシュを削除する。存在しない・消せない場合も黙って無視する */
export async function deleteCache(request: CacheRequest, cacheDir = getCacheDir()): Promise<void> {
  await unlink(getCacheFilePath(request, cacheDir)).catch(() => {});
}

/** 使えるキャッシュが存在するか。--refresh が失敗したときの案内に使う */
export async function hasCachedEntry(
  request: CacheRequest,
  cacheDir = getCacheDir(),
): Promise<boolean> {
  return (await readCache(request, cacheDir)) !== undefined;
}

/**
 * キャッシュを書く。
 * 一時ファイルへ書いてから rename することでアトミックにする。レスポンスは
 * 数 MB になりうるので、直接上書きすると中断や並行実行で破損したファイルが残る。
 * 中身は未公開のデザインデータなので、他ユーザーから読めない権限で作成する
 */
export async function writeCache(
  request: CacheRequest,
  response: FigmaNodesResponse,
  fetchedAt: string,
  cacheDir = getCacheDir(),
): Promise<Result<void, AppError>> {
  const filePath = getCacheFilePath(request, cacheDir);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const entry: CacheEntry = { fetchedAt, request, response };

  try {
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    await writeFile(tmpPath, JSON.stringify(entry), { encoding: "utf-8", mode: 0o600 });
    await rename(tmpPath, filePath);
    return ok(undefined);
  } catch (error: unknown) {
    // rename まで到達できなかった場合に一時ファイルを残さない
    await unlink(tmpPath).catch(() => {});
    return err({ type: "CONFIG_WRITE_ERROR", cause: error });
  }
}

/** 経過時間を人間向けの短い表記にする（純粋関数） */
export function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

export type BuildCacheMetaInput = {
  hit: boolean;
  /** このレスポンスがディスク上のキャッシュに存在するか。ヒット時は常に true */
  cached: boolean;
  fetchedAt: string;
  now: number;
};

/**
 * 出力に添える CacheMeta を組み立てる（純粋関数）。
 * note を持たせているのは、SKILL.md が `figma-reader install` でリポジトリへ
 * コピーされる仕組みのため。CLI だけを更新したユーザーの手元には
 * キャッシュを知らない古い SKILL.md が残るので、出力自体を自己説明的にする
 */
export function buildCacheMeta({ hit, cached, fetchedAt, now }: BuildCacheMetaInput): CacheMeta {
  // 時計の巻き戻し（NTP 補正、VM スナップショットからの復帰）で負値になると
  // 「fetched -3h ago」のような出力になるため 0 で下限を切る
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 1000));
  return { hit, cached, fetchedAt, ageSeconds, note: buildNote(hit, cached, ageSeconds) };
}

/**
 * note は stdout の JSON に載る唯一の説明であり、エージェントが実際に読む経路。
 * 保存できなかったことを黙っていると「もう一度呼んでも無料」と誤解され、
 * レートリミットを不意に消費させてしまう
 */
function buildNote(hit: boolean, cached: boolean, ageSeconds: number): string {
  if (hit) {
    return `Served from local cache fetched ${formatAge(ageSeconds)} ago; the design may have changed since. Re-run with --refresh to fetch from the Figma API.`;
  }
  return cached
    ? "Fetched from the Figma API and cached locally."
    : "Fetched from the Figma API but NOT cached; an identical request will call the API again.";
}

function isSameRequest(a: CacheRequest | undefined, b: CacheRequest): boolean {
  // 手編集や旧フォーマットで request ごと欠けている場合があるため、
  // 各項目の比較より先に存在を確かめる
  if (!a || !Array.isArray(a.nodeIds)) {
    return false;
  }
  return (
    a.fileKey === b.fileKey &&
    a.depth === b.depth &&
    a.geometry === b.geometry &&
    a.nodeIds.length === b.nodeIds.length &&
    a.nodeIds.every((id, i) => id === b.nodeIds[i])
  );
}
