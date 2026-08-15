import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
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

/** Figma API から指定ノードのデザインコンテキストを取得する */
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
