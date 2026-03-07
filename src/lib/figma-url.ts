import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "./error.js";

export type FigmaUrlParams = {
  fileKey: string;
  nodeId: string;
};

/**
 * Figma のデザイン URL を解析して fileKey と nodeId を抽出する。
 * node-id の `-` は `:` に変換する。
 *
 * 対応形式:
 * - https://www.figma.com/design/:fileKey/:fileName?node-id=:nodeId
 * - https://www.figma.com/design/:fileKey/branch/:branchKey/:fileName?node-id=:nodeId
 */
export function parseFigmaUrl(url: string): Result<FigmaUrlParams, AppError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err({ type: "INVALID_URL", message: "URL の形式が正しくありません" });
  }

  if (parsed.hostname !== "www.figma.com" && parsed.hostname !== "figma.com") {
    return err({ type: "INVALID_URL", message: "Figma の URL ではありません" });
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // /design/:fileKey/... の形式を期待
  if (segments[0] !== "design" || segments.length < 2) {
    return err({ type: "INVALID_URL", message: "/design/ 形式の URL のみ対応しています" });
  }

  // branch URL の場合、branchKey を API の fileKey として使う（Figma API の仕様）
  // 通常: /design/:fileKey/:fileName → segments[1] が fileKey
  // ブランチ: /design/:fileKey/branch/:branchKey/:fileName → segments[3] が branchKey
  const fileKey = segments[2] === "branch" && segments[3] ? segments[3] : segments[1];

  const nodeIdParam = parsed.searchParams.get("node-id");
  if (!nodeIdParam) {
    return err({ type: "INVALID_URL", message: "node-id パラメータがありません" });
  }

  const nodeId = nodeIdParam.replace(/-/g, ":");

  return ok({ fileKey, nodeId });
}
