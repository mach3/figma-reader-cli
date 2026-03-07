import type { Result } from "neverthrow";
import { err } from "neverthrow";
import type { AppError } from "../../lib/error.js";
import { type FigmaNodesResponse, figmaGet } from "../../lib/figma-client.js";

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

  return result;
}
