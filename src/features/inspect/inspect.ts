import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import {
  buildCacheKey,
  buildCacheMeta,
  buildDisabledCacheMeta,
  type CacheMeta,
  type CacheRequest,
  type CacheSettings,
  type CacheWriteFailure,
  deleteCache,
  getWriteErrorCode,
  hasCachedEntry,
  normalizeRequest,
  readCache,
  sanitizeFileKey,
  writeCache,
} from "../../lib/cache.js";
import { type AppError, getErrnoCode } from "../../lib/error.js";
import { type FigmaNodesResponse, figmaGet } from "../../lib/figma-client.js";
import { checkOutputDir } from "../../lib/output-dir.js";

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

/**
 * --output の値と併用フラグを検証する。値そのものの規則は export と共通の checkOutputDir に従う。
 * `--output --pretty` は output:"--pretty", pretty:false で届くため、値の検査を --pretty より先に行う
 */
export function checkOutputOption({
  output,
  pretty,
}: {
  output: string | boolean | undefined;
  pretty: boolean;
}): Result<void, AppError> {
  if (output === undefined) {
    return ok(undefined);
  }
  const dirResult = checkOutputDir(output);
  if (dirResult.isErr()) {
    return err(dirResult.error);
  }
  // ファイル名を渡す誤用を素通しすると、`design.json/` というディレクトリが黙って作られ成功に見える
  if (dirResult.value.toLowerCase().endsWith(".json")) {
    return err({
      type: "CUSTOM_ERROR",
      message: `--output takes a directory, not a file name: ${dirResult.value}. The file name is chosen by the CLI and reported as "path" on stdout`,
    });
  }
  if (pretty) {
    return err({ type: "CUSTOM_ERROR", message: "--output cannot be combined with --pretty" });
  }
  return ok(undefined);
}

/** 深い入れ子インスタンスの id（`I1:2;3:4;...`）でも NAME_MAX を超えないための上限。一意性はハッシュが担う */
const OUTPUT_ID_MAX_LENGTH = 32;

/**
 * --output で書くファイルの名前を決める（純粋関数）。
 * `<fileKey>_<先頭id>[+<残り個数>]_<hash>[_styles].json`。hash はキャッシュキーと同じなので
 * --depth / --geometry の違いはここで区別される。--styles はキャッシュキーに含まれず
 * 出力の形だけを変えるため、接尾辞で分ける
 */
export function buildOutputFileName(request: CacheRequest, styles: boolean): string {
  const [firstId = "", ...rest] = request.nodeIds;
  const id = firstId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, OUTPUT_ID_MAX_LENGTH);
  const restCount = rest.length > 0 ? `+${rest.length}` : "";
  const stylesSuffix = styles ? "_styles" : "";
  return `${sanitizeFileKey(request.fileKey)}_${id}${restCount}_${buildCacheKey(request)}${stylesSuffix}.json`;
}

/**
 * --output の一時ファイル名。出力先は共有ディレクトリのこともあるため、推測できる名前
 * （pid など）にすると、他人が先に置いたシンボリックリンクを辿って任意のファイルを上書きさせられる。
 * ランダムな接尾辞にしたうえで、作成は必ず wx（既存なら失敗）で行う
 */
function buildTmpPath(absPath: string): string {
  return `${absPath}.${randomBytes(8).toString("hex")}.tmp`;
}

/**
 * --output のディレクトリを作り、書き込み先の絶対パスを確定させる。API を呼ぶ前に使う。
 * mkdir は既存ディレクトリなら書き込めなくても成功するため、確定した名前で実際に試し書きする。
 * キャッシュも書けない環境（sandbox など）では、ここで弾かないと API の消費分が丸ごと無駄になる
 */
export async function prepareOutputFile({
  dir,
  request,
  styles,
  cwd,
}: {
  dir: string;
  request: CacheRequest;
  styles: boolean;
  cwd: string;
}): Promise<Result<string, AppError>> {
  const absDir = resolve(cwd, dir);
  try {
    await mkdir(absDir, { recursive: true });
  } catch (error: unknown) {
    return err({
      type: "CUSTOM_ERROR",
      message: `Failed to create the --output directory ${absDir} (${getErrnoCode(error)}); no API request was made`,
    });
  }

  const absPath = join(absDir, buildOutputFileName(request, styles));
  const tmpPath = buildTmpPath(absPath);
  try {
    await writeFile(tmpPath, "", { encoding: "utf-8", flag: "wx" });
  } catch (error: unknown) {
    return err({
      type: "CUSTOM_ERROR",
      message: `Cannot write to ${absPath} (${getErrnoCode(error)}); no API request was made`,
    });
  }
  // 試し書きが通った出力先で削除だけが拒否されるのは稀なので、消せなかった空ファイルは許容する
  await unlink(tmpPath).catch(() => {});
  return ok(absPath);
}

/**
 * --output のファイルを書く。
 * writeCache と同じく一時ファイルへ書いてから rename する。直接上書きすると、中断や
 * ENOSPC で既存の正常な JSON が壊れたまま残り、後続のエージェントが不正な JSON を掴む
 */
export async function writeOutputFile(
  absPath: string,
  content: string,
): Promise<Result<void, AppError>> {
  const tmpPath = buildTmpPath(absPath);
  let created = false;
  try {
    await writeFile(tmpPath, content, { encoding: "utf-8", flag: "wx" });
    created = true;
    await rename(tmpPath, absPath);
    return ok(undefined);
  } catch (error: unknown) {
    // rename まで到達できなかった場合に一時ファイルを残さない。wx で作れなかった場合、
    // その名前の実体は自分のものではないので消さない
    if (created) {
      await unlink(tmpPath).catch(() => {});
    }
    return err({
      type: "CUSTOM_ERROR",
      // 同名の旧ファイルは残る。エラーを見落としたエージェントが古い内容を最新と読まないよう明示する
      message: `Failed to write the --output file ${absPath} (${getErrnoCode(error)}); any existing file at that path was not updated`,
    });
  }
}

/**
 * --output の書き込みに失敗したときの回復手段。取得はもう済んでいるため、
 * 再実行が API を消費するかどうかをエージェントが判断できるようにする。
 * 書けない環境で `> file` に逃げると sandbox の excludedCommands が外れるので、--output での再実行へ誘導する
 */
export function buildOutputWriteHint({
  cached,
  refresh,
  staleEntryRemains,
}: {
  cached: boolean;
  refresh: boolean;
  staleEntryRemains: boolean;
}): string {
  // staleEntryRemains が true のとき cached は必ず false なので、先に判定する。
  // --refresh なしでこの状態になるのは古いエントリを読めなかった場合だけなので、再実行しても
  // それは返らず API を呼ぶ。--refresh 付きでも読み取りは試していないので、古いエントリが
  // 読めるとは限らない。「無料で返る」と断定せず、読めなければ API を消費することも伝える
  const cost =
    staleEntryRemains && refresh
      ? "The response was not cached, and an older cached response could not be removed. Re-running without --refresh may return that stale response without an API request; if it cannot be read, the re-run spends another request, as does re-running with --refresh."
      : !cached
        ? "The response was not cached, so re-running will spend another API request."
        : refresh
          ? "The response was stored in the local cache. Re-run without --refresh to get it without an API request."
          : "The response is in the local cache, so re-running will not spend an API request.";
  return `${cost} Re-run with --output pointing to a directory you can write to (e.g. inside the working directory).`;
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

export type CacheableNodesOptions = GetNodesOptions & { cache: CacheSettings };

export type GetNodesWithCacheOptions = CacheableNodesOptions & { refresh: boolean };

/**
 * 同じ条件のキャッシュが手元にあるかを返す。
 * キャッシュキーの組み立てを getNodesWithCache と同じ場所に閉じ込めるための入口で、
 * --refresh が失敗したときに「キャッシュを使えば取得できる」と案内するために使う
 */
export async function hasCachedNodes(options: CacheableNodesOptions): Promise<boolean> {
  // 無効時はディスクを一切触らない約束なので、ファイルが残っていても読まない
  if (!options.cache.enabled) {
    return false;
  }
  return hasCachedEntry(normalizeRequest(options), options.cache.dir);
}

export type CachedNodesResult = {
  response: FigmaNodesResponse;
  meta: CacheMeta;
  /** 正規化済みのリクエスト。呼び出し元が「要求した node-id」を知るために使う */
  request: CacheRequest;
  /** キャッシュ書き込みの失敗内容。コマンド自体は成功させたうえで呼び出し元が警告する。失敗していなければ undefined */
  writeFailure: CacheWriteFailure | undefined;
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
  const { cache } = options;

  if (cache.enabled && !options.refresh) {
    const entry = await readCache(request, cache.dir);
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
        writeFailure: undefined,
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

  // 無効時は読み取り・書き込み・削除のいずれにも到達させない。とりわけ下の
  // 「保存しなかったら deleteCache」に落とすと、一時的に切っただけで既存キャッシュが消える。
  // --refresh の「最新を取れ」という意図は毎回 API を呼ぶことで満たされるので無視してよい
  if (!cache.enabled) {
    return ok({
      response,
      meta: buildDisabledCacheMeta({ fetchedAt }),
      request,
      writeFailure: undefined,
      staleEntryRemains: false,
    });
  }

  // TTL を設けていないため、権限反映待ち・未作成フレーム・id の typo で得た
  // 空の結果を保存すると永久に固定されてしまう
  const writeResult = hasUnresolvedNode(request, response)
    ? undefined
    : await writeCache(request, response, fetchedAt, cache.dir);
  const stored = writeResult?.isOk() ?? false;
  const writeFailure = writeResult?.isErr()
    ? { code: getWriteErrorCode(writeResult.error), dir: cache.dir }
    : undefined;

  // 取得したのに保存しなかった場合は、古いエントリを必ず消す。writeCache は
  // 一時ファイル → rename で書くため失敗時は既存ファイルが手つかずで残り、
  // --refresh で取り直した直後でも次の通常呼び出しが古いデザインを hit として
  // 返してしまう。「保存しなかったならディスクにも残っていない」を不変条件にする
  const discardResult = stored ? undefined : await deleteCache(request, cache.dir);
  const staleEntryRemains = discardResult?.isErr() ?? false;

  return ok({
    response,
    meta: buildCacheMeta({
      hit: false,
      cached: stored,
      staleEntryRemains,
      writeFailure,
      fetchedAt,
      now: Date.now(),
    }),
    request,
    writeFailure,
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
