import type { Result } from "neverthrow";
import type { AppError } from "../../lib/error.js";
import { type FigmaUser, figmaGet } from "../../lib/figma-client.js";

/** Figma API `/v1/me` からユーザー情報を取得する */
export async function getMe(token: string): Promise<Result<FigmaUser, AppError>> {
  return figmaGet<FigmaUser>(token, "/v1/me");
}
