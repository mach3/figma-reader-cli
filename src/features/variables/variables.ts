import type { Result } from "neverthrow";
import { err } from "neverthrow";
import type { AppError } from "../../lib/error.js";
import {
  type FigmaLocalVariablesResponse,
  type FigmaPublishedVariablesResponse,
  figmaGet,
} from "../../lib/figma-client.js";

export type GetVariablesOptions = {
  fileKey: string;
  token: string;
  published: boolean;
};

/** Figma API からファイル内の変数を取得する */
export async function getVariables(
  options: GetVariablesOptions,
): Promise<Result<FigmaLocalVariablesResponse | FigmaPublishedVariablesResponse, AppError>> {
  const endpoint = options.published ? "published" : "local";
  const path = `/v1/files/${options.fileKey}/variables/${endpoint}`;

  const result = await figmaGet<FigmaLocalVariablesResponse | FigmaPublishedVariablesResponse>(
    options.token,
    path,
  );

  if (result.isErr()) {
    return result;
  }

  if (result.value.error) {
    return err({ type: "API_ERROR", status: result.value.status, message: "Variables API error" });
  }

  return result;
}
