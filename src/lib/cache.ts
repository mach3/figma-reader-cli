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
  /**
   * この呼び出しの結果がディスク上のキャッシュに保存されているか。false なら同じ要求が再び API を消費する。
   * キャッシュ無効時は常に false だが、無効化前に保存されたファイルは消さないため残っていることがある
   */
  cached: boolean;
  /** キャッシュ機能が有効か。false なら FIGMA_READER_CACHE で無効化されており、ディスクには一切触れていない */
  enabled: boolean;
  fetchedAt: string;
  ageSeconds: number;
  note: string;
};

/** キャッシュ書き込みの失敗内容。dir は書き込みを許可すべき単位であるキャッシュのルート */
export type CacheWriteFailure = { code: string; dir: string };

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
 * キャッシュの有効/無効と保存先。
 * 無効側に dir を持たせないのは、無効時にパスを組み立ててディスクへ触れる経路
 * （とりわけ既存キャッシュの削除）を型の上で断つため
 */
export type CacheSettings = { enabled: false } | { enabled: true; dir: string };

const ENABLED_VALUES = ["1", "true", "on"];
const DISABLED_VALUES = ["0", "false", "off"];

/**
 * 環境変数からキャッシュ設定を解決する。
 * inspect がキャッシュを参照する時点でだけ呼ぶこと。起動時に読むと、
 * キャッシュを使わない auth や me まで env の不正値で落ちてしまう
 */
export function resolveCacheSettings(): Result<CacheSettings, AppError> {
  const rawSwitch = process.env.FIGMA_READER_CACHE;
  // .env・CI の環境変数 UI・YAML は末尾空白や `True` を混入させるため正規化して照合する。
  // 空は未設定扱い。`FIGMA_READER_CACHE=$UNDEFINED` で空文字が渡るスクリプトを壊さないため
  const normalizedSwitch = rawSwitch?.trim().toLowerCase() ?? "";
  if (DISABLED_VALUES.includes(normalizedSwitch)) {
    // 使わないパスの妥当性で起動不能にしないよう、DIR は読みもしない
    return ok({ enabled: false });
  }
  if (normalizedSwitch !== "" && !ENABLED_VALUES.includes(normalizedSwitch)) {
    return err({
      type: "CUSTOM_ERROR",
      message: `FIGMA_READER_CACHE must be one of ${[...ENABLED_VALUES, ...DISABLED_VALUES].join(", ")} (case-insensitive); got ${JSON.stringify(rawSwitch)}. To change the cache location, use FIGMA_READER_CACHE_DIR`,
    });
  }

  const rawDir = process.env.FIGMA_READER_CACHE_DIR;
  // 生の値ではなく trim 後の値を使う。先頭に空白が残ると join の結果が
  // 相対パスに化け、検証を通ったまま cwd 配下へ書き出されてしまう
  const dir = rawDir?.trim() ?? "";
  if (dir !== "") {
    // 相対パスはエージェントの起動場所ごとに別ディレクトリへ解決され、
    // キャッシュが黙って分裂する。「効かない」より原因究明が難しいので拒否する
    if (!isAbsolute(dir)) {
      return err({
        type: "CUSTOM_ERROR",
        message: `FIGMA_READER_CACHE_DIR must be an absolute path; got ${JSON.stringify(rawDir)}. "~" and environment variables are not expanded`,
      });
    }
    // 専用ディレクトリとして指定される前提なので figma-reader/ は付けない
    return ok({ enabled: true, dir });
  }

  return ok({ enabled: true, dir: getDefaultCacheDir() });
}

/**
 * FIGMA_READER_CACHE_DIR 未指定時のルートを返す。
 * XDG_CACHE_HOME は**絶対パスのときだけ**採用する。XDG Base Directory 仕様が
 * 相対パスを無効と定めており、`XDG_CACHE_HOME=.cache` のような設定を
 * そのまま使うとキャッシュが cwd（多くはリポジトリルート）に書き出され、
 * デザインデータがリポジトリへ漏れるため。他ツール向けの設定を横から読んでいる
 * だけなので、不正値でもエラーにはせずフォールバックする
 */
function getDefaultCacheDir(): string {
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

/**
 * キャッシュファイルの絶対パスを返す。
 * cacheDir を必須にしているのは、既定値で補うと FIGMA_READER_CACHE の無効化や
 * FIGMA_READER_CACHE_DIR の検証を素通りしてディスクへ触れる経路ができるため
 */
export function getCacheFilePath(request: CacheRequest, cacheDir: string): string {
  return join(cacheDir, sanitizeFileKey(request.fileKey), `${buildCacheKey(request)}.json`);
}

/**
 * キャッシュを読む。**あらゆる失敗で undefined を返す**。
 * キャッシュは最適化であり、読めないことが inspect の失敗になってはならないため、
 * ENOENT だけでなく EACCES・ENOTDIR・JSON パース失敗もすべてミス扱いにする
 */
export async function readCache(
  request: CacheRequest,
  cacheDir: string,
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

/**
 * キャッシュを削除する。元から存在しない場合は成功として扱う。
 * 失敗を握り潰すと、取り直したデータを保存できなかったのに古いエントリが残り、
 * 次の通常呼び出しがそれを hit として返してしまうため、結果は呼び出し元へ返す
 */
export async function deleteCache(
  request: CacheRequest,
  cacheDir: string,
): Promise<Result<void, AppError>> {
  try {
    await unlink(getCacheFilePath(request, cacheDir));
    return ok(undefined);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(undefined);
    }
    return err({ type: "CONFIG_WRITE_ERROR", cause: error });
  }
}

/** 使えるキャッシュが存在するか。--refresh が失敗したときの案内に使う */
export async function hasCachedEntry(request: CacheRequest, cacheDir: string): Promise<boolean> {
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
  cacheDir: string,
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
  /** 保存できなかったうえ、古いエントリの破棄にも失敗したか */
  staleEntryRemains?: boolean;
  /** 書き込みを試みて失敗した場合の内容。未解決 id のために書き込まなかった場合は渡さない */
  writeFailure?: CacheWriteFailure;
  fetchedAt: string;
  now: number;
};

/**
 * 出力に添える CacheMeta を組み立てる（純粋関数）。
 * note を持たせているのは、SKILL.md が `figma-reader install` でリポジトリへ
 * コピーされる仕組みのため。CLI だけを更新したユーザーの手元には
 * キャッシュを知らない古い SKILL.md が残るので、出力自体を自己説明的にする
 */
export function buildCacheMeta({
  hit,
  cached,
  staleEntryRemains = false,
  writeFailure,
  fetchedAt,
  now,
}: BuildCacheMetaInput): CacheMeta {
  // 時計の巻き戻し（NTP 補正、VM スナップショットからの復帰）で負値になると
  // 「fetched -3h ago」のような出力になるため 0 で下限を切る
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 1000));
  return {
    hit,
    cached,
    enabled: true,
    fetchedAt,
    ageSeconds,
    note: buildNote({ hit, cached, staleEntryRemains, writeFailure, ageSeconds }),
  };
}

/**
 * キャッシュ無効時の CacheMeta を組み立てる（純粋関数）。
 * 無効と「書き込みに失敗した」はどちらも hit:false, cached:false になるため、
 * enabled と note で区別しないと消費側が「次は使える」と誤解する
 */
export function buildDisabledCacheMeta({ fetchedAt }: { fetchedAt: string }): CacheMeta {
  return {
    hit: false,
    cached: false,
    enabled: false,
    fetchedAt,
    ageSeconds: 0,
    note: "Cache disabled by FIGMA_READER_CACHE; fetched from the Figma API and NOT cached. Every request calls the API. Existing cache files were left untouched and may be served again once the cache is re-enabled.",
  };
}

/** 書き込み失敗の原因となったエラーコード（EPERM など）を取り出す。取り出せなければ "unknown" */
export function getWriteErrorCode(error: AppError): string {
  if (error.type !== "CONFIG_WRITE_ERROR") {
    return "unknown";
  }
  // Error インスタンスに限らない。モックや別 realm から来た errno 風のオブジェクトでも code は読める
  const { cause } = error;
  return typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
    ? cause.code
    : "unknown";
}

/**
 * 書き込み失敗の原因と回復手段を述べる文。note と stderr の警告の両方で使い、文面を二重管理しない。
 * sandbox（Claude Code など）がホーム配下への書き込みを拒否すると、キャッシュが一度も溜まらないまま
 * 誰も気づかないため、原因と書き込み先を明示する。sandbox の設定キー名は仕様変更で嘘になりうるので出さない
 */
export function formatCacheWriteHint({ code, dir }: CacheWriteFailure): string {
  return `Writing the cache under ${dir} failed (${code}). If this runs in a sandbox (e.g. Claude Code), allow writes to ${dir}, or set FIGMA_READER_CACHE_DIR to a writable absolute path. FIGMA_READER_CACHE=off skips the cache entirely.`;
}

/**
 * note は stdout の JSON に載る唯一の説明であり、エージェントが実際に読む経路。
 * 保存できなかったことを黙っていると「もう一度呼んでも無料」と誤解され、
 * レートリミットを不意に消費させてしまう
 */
function buildNote({
  hit,
  cached,
  staleEntryRemains,
  writeFailure,
  ageSeconds,
}: {
  hit: boolean;
  cached: boolean;
  staleEntryRemains: boolean;
  writeFailure: CacheWriteFailure | undefined;
  ageSeconds: number;
}): string {
  if (hit) {
    return `Served from local cache fetched ${formatAge(ageSeconds)} ago; the design may have changed since. Re-run with --refresh to fetch from the Figma API.`;
  }
  if (cached) {
    return "Fetched from the Figma API and cached locally.";
  }
  // 「次回は API を呼ぶ」と言い切れるのは古いエントリが残っていないときだけ
  const notCached = staleEntryRemains
    ? "Fetched from the Figma API but NOT cached, and an older cached response could not be removed; an identical request without --refresh may return that stale response instead."
    : "Fetched from the Figma API but NOT cached; an identical request will call the API again.";
  return writeFailure ? `${notCached} ${formatCacheWriteHint(writeFailure)}` : notCached;
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
