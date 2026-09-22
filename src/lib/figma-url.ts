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
export function parseFigmaUrl(
  url: string,
): Result<FigmaUrlParams, Extract<AppError, { type: "INVALID_URL" }>> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err({ type: "INVALID_URL", message: "Malformed URL" });
  }

  if (parsed.hostname !== "www.figma.com" && parsed.hostname !== "figma.com") {
    return err({ type: "INVALID_URL", message: "Not a Figma URL" });
  }

  const segments = parsed.pathname.split("/").filter(Boolean);

  // /design/:fileKey/... の形式を期待
  if (segments[0] !== "design" || segments.length < 2) {
    return err({ type: "INVALID_URL", message: "Only /design/ URLs are supported" });
  }

  // branch URL の場合、branchKey を API の fileKey として使う（Figma API の仕様）
  // 通常: /design/:fileKey/:fileName → segments[1] が fileKey
  // ブランチ: /design/:fileKey/branch/:branchKey/:fileName → segments[3] が branchKey
  const fileKey = segments[2] === "branch" && segments[3] ? segments[3] : segments[1];

  const nodeIdParam = parsed.searchParams.get("node-id");
  if (!nodeIdParam) {
    return err({ type: "INVALID_URL", message: "Missing node-id parameter" });
  }

  const nodeId = nodeIdParam.replace(/-/g, ":");

  return ok({ fileKey, nodeId });
}

export type FigmaUrlsParams = {
  fileKey: string;
  /**
   * 与えられた URL の node-id を入力順に並べたもの。
   * 1 本の URL が持つカンマ区切りの node-id は個別の要素へ展開する。
   * 要素が「本当に 1 つの node-id」であることは、呼び出し元がこれを
   * レスポンスのキーと突き合わせるために必要な不変条件
   */
  nodeIds: string[];
};

/**
 * 複数の Figma URL を解析し、単一ファイルに対する node-id の並びへ解決する。
 *
 * Figma の `/v1/files/:key/nodes` は 1 リクエストで 1 ファイルしか扱えないため、
 * fileKey が混在する入力はここで弾いて呼び出し元に判断を返す。CLI 側で黙って
 * ファイルごとに複数回呼ぶと、1 回に見えて N 回ぶんのレートリミットを消費する。
 *
 * 呼び出し元は citty の `args._`（宣言済み positional を含むすべての positional）を
 * そのまま渡す。citty は `parsed._` の**コピー**から shift するため `args._[0]` は
 * 宣言した positional と同じ値であり、`[args.url, ...args._]` と書くと先頭が重複する
 */
export function parseFigmaUrls(urls: string[]): Result<FigmaUrlsParams, AppError> {
  const parsed: { url: string; fileKey: string; nodeIds: string[] }[] = [];

  for (const url of urls) {
    const result = parseFigmaUrl(url);
    if (result.isErr()) {
      // positional 引数はすべて URL として扱われるため、フラグ名を打ち間違えると
      // その値がここへ流れ込む（`--dept 3` の `3` など）。どの引数が問題かを
      // 添えないと、真の原因が出力のどこにも現れず URL 側を疑わせてしまう
      return err({
        type: "INVALID_URL",
        message: `${result.error.message} (argument: "${url}"). Every positional argument is treated as a Figma URL; if this was meant as a flag value, check the flag name`,
      });
    }

    // `?node-id=1-2,10-99` を個別の id へ割る。合成文字列のまま下流へ渡すと、
    // Figma が個別キーで返すレスポンスと照合できず、成功した取得を失敗と誤判定する。
    // 空要素は URL 上の書式の綾（末尾カンマ）でありノードの取りこぼしではないため落とす
    const nodeIds = result.value.nodeId
      .split(",")
      .map((nodeId) => nodeId.trim())
      .filter((nodeId) => nodeId !== "");
    if (nodeIds.length === 0) {
      return err({
        type: "INVALID_URL",
        message: `node-id contains no usable id (argument: "${url}")`,
      });
    }

    parsed.push({ url, fileKey: result.value.fileKey, nodeIds });
  }

  const first = parsed[0];
  if (!first) {
    return err({ type: "INVALID_URL", message: "No Figma URL was given" });
  }

  if (parsed.some((entry) => entry.fileKey !== first.fileKey)) {
    // fileKey の初出順を保つため Map を使う。グループ化はこのエラー経路でしか要らない
    const groups = new Map<string, string[]>();
    for (const entry of parsed) {
      // URL は入力されたままの文字列を返す。呼び出し元がそのまま実行し直せるようにするため
      const urls = groups.get(entry.fileKey);
      if (urls) {
        urls.push(entry.url);
      } else {
        groups.set(entry.fileKey, [entry.url]);
      }
    }
    return err({
      type: "MULTIPLE_FILE_KEYS",
      groups: [...groups].map(([fileKey, urls]) => ({ fileKey, urls })),
    });
  }

  return ok({ fileKey: first.fileKey, nodeIds: parsed.flatMap((entry) => entry.nodeIds) });
}
