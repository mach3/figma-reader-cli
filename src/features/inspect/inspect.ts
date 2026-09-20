import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import {
  buildCacheMeta,
  type CacheMeta,
  type CacheRequest,
  deleteCache,
  hasCachedEntry,
  normalizeRequest,
  readCache,
  writeCache,
} from "../../lib/cache.js";
import type { AppError } from "../../lib/error.js";
import { type FigmaNodesResponse, figmaGet } from "../../lib/figma-client.js";

type StylesConflictOptions = {
  styles: boolean;
  pretty: boolean;
  geometry: boolean;
};

/**
 * --styles と併用できないフラグを検出する。
 * --styles は機械可読出力専用。--pretty との暗黙の優先順位を作らず明示的にエラーにする。
 * --geometry はフィルタが fillGeometry/strokeGeometry を除去するため、重い API レスポンスを
 * 取得した末に黙って捨てることになる。どちらも黙殺せずエラーで返す。
 */
export function checkStylesConflict({
  styles,
  pretty,
  geometry,
}: StylesConflictOptions): Result<void, AppError> {
  const conflicted = pretty ? "--pretty" : geometry ? "--geometry" : undefined;
  if (styles && conflicted) {
    return err({
      type: "CUSTOM_ERROR",
      message: `--styles cannot be combined with ${conflicted}`,
    });
  }
  return ok(undefined);
}

/** --depth をパースする。未指定は undefined のまま通す */
export function parseDepth(depth: string | undefined): Result<number | undefined, AppError> {
  if (depth === undefined) {
    return ok(undefined);
  }

  const parsed = Number.parseInt(depth, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return err({ type: "CUSTOM_ERROR", message: "--depth must be a positive integer" });
  }
  return ok(parsed);
}

export type GetNodesOptions = {
  fileKey: string;
  nodeId: string;
  token: string;
  depth?: number;
  geometry?: boolean;
};

/**
 * Figma API から指定ノードのデザインコンテキストを取得する。
 * inspect コマンドからはキャッシュを経由する `getNodesWithCache` を使うこと。
 * この関数を直接呼ぶとレートリミット対策のキャッシュを素通りする
 */
export async function getNodes(
  options: GetNodesOptions,
): Promise<Result<FigmaNodesResponse, AppError>> {
  const params = new URLSearchParams({ ids: options.nodeId });

  if (options.depth !== undefined) {
    params.set("depth", String(options.depth));
  }
  if (options.geometry) {
    params.set("geometry", "paths");
  }

  const result = await figmaGet<FigmaNodesResponse>(
    options.token,
    `/v1/files/${options.fileKey}/nodes?${params}`,
  );

  if (result.isErr()) {
    return result;
  }

  // Figma API は HTTP 200 でもレスポンスボディに err フィールドを含む場合がある
  if (result.value.err) {
    return err({ type: "API_ERROR", status: 200, message: result.value.err });
  }

  // 200 でも nodes を欠く想定外のボディは、下流で TypeError になる前に
  // 機械可読エラーとして返す（figmaGet はレスポンス形状を検証しないため）
  if (result.value.nodes === undefined || result.value.nodes === null) {
    return err({
      type: "API_ERROR",
      status: 200,
      message: "Unexpected response: missing 'nodes' field",
    });
  }

  return result;
}

export type CacheableNodesOptions = GetNodesOptions & { cacheDir?: string };

export type GetNodesWithCacheOptions = CacheableNodesOptions & { refresh: boolean };

/**
 * 同じ条件のキャッシュが手元にあるかを返す。
 * キャッシュキーの組み立てを getNodesWithCache と同じ場所に閉じ込めるための入口で、
 * --refresh が失敗したときに「キャッシュを使えば取得できる」と案内するために使う
 */
export async function hasCachedNodes(options: CacheableNodesOptions): Promise<boolean> {
  return hasCachedEntry(normalizeRequest(options), options.cacheDir);
}

export type CachedNodesResult = {
  response: FigmaNodesResponse;
  meta: CacheMeta;
  /** 正規化済みのリクエスト。呼び出し元が「要求した node-id」を知るために使う */
  request: CacheRequest;
  /** キャッシュ書き込みに失敗したか。コマンド自体は成功させたうえで呼び出し元が警告する */
  cacheWriteFailed: boolean;
  /** 保存しなかったうえ、古いエントリの破棄にも失敗したか。次の通常呼び出しが古い結果を返しうる */
  staleEntryRemains: boolean;
};

/**
 * キャッシュを参照しつつデザインコンテキストを取得する。
 * Figma API のレートリミットは回復までが数時間〜1日規模のため、既定では
 * ローカルのキャッシュを優先し、`refresh` が指定されたときだけ API を呼ぶ
 */
export async function getNodesWithCache(
  options: GetNodesWithCacheOptions,
): Promise<Result<CachedNodesResult, AppError>> {
  const request = normalizeRequest(options);

  if (!options.refresh) {
    const entry = await readCache(request, options.cacheDir);
    if (entry) {
      return ok({
        response: entry.response,
        meta: buildCacheMeta({
          hit: true,
          cached: true,
          fetchedAt: entry.fetchedAt,
          now: Date.now(),
        }),
        request,
        cacheWriteFailed: false,
        staleEntryRemains: false,
      });
    }
  }

  // API へ送る id とキャッシュキー／未解決判定に使う id を同じ値から導出する。
  // 別々にすると、入力に空白が混ざったときに送信側と判定側がズレ、
  // 正常なレスポンスが恒久的に「未解決」扱いになってキャッシュが効かなくなる
  const result = await getNodes({ ...options, nodeId: request.nodeIds.join(",") });
  if (result.isErr()) {
    return err(result.error);
  }

  const response = result.value;
  const fetchedAt = new Date().toISOString();

  // TTL を設けていないため、権限反映待ち・未作成フレーム・id の typo で得た
  // 空の結果を保存すると永久に固定されてしまう
  const writeResult = hasUnresolvedNode(request, response)
    ? undefined
    : await writeCache(request, response, fetchedAt, options.cacheDir);
  const stored = writeResult?.isOk() ?? false;

  // 取得したのに保存しなかった場合は、古いエントリを必ず消す。writeCache は
  // 一時ファイル → rename で書くため失敗時は既存ファイルが手つかずで残り、
  // --refresh で取り直した直後でも次の通常呼び出しが古いデザインを hit として
  // 返してしまう。「保存しなかったならディスクにも残っていない」を不変条件にする
  const discardResult = stored ? undefined : await deleteCache(request, options.cacheDir);
  const staleEntryRemains = discardResult?.isErr() ?? false;

  return ok({
    response,
    meta: buildCacheMeta({
      hit: false,
      cached: stored,
      staleEntryRemains,
      fetchedAt,
      now: Date.now(),
    }),
    request,
    cacheWriteFailed: writeResult?.isErr() ?? false,
    staleEntryRemains,
  });
}

/**
 * 要求した node-id のどれかが取得できていないかを判定する。
 * Figma は解決できない id を HTTP 200 + `nodes[id] === null` で返すが、
 * キーごと欠けるケースもあるため、null の有無だけでなく要求した id が
 * すべて揃っているかも確かめる
 */
function hasUnresolvedNode(request: CacheRequest, response: FigmaNodesResponse): boolean {
  return request.nodeIds.some((id) => response.nodes[id] == null);
}
