import { proxyHint } from "./proxy.js";

/** アプリケーション全体で使う共通エラー型 */
export type AppError =
  | { type: "CONFIG_READ_ERROR"; cause: unknown }
  | { type: "CONFIG_WRITE_ERROR"; cause: unknown }
  | { type: "API_ERROR"; status: number; message: string; retryAfter?: number }
  | { type: "NETWORK_ERROR"; cause: unknown }
  | { type: "UNAUTHENTICATED" }
  | { type: "TOKEN_NOT_FOUND"; message: string }
  | { type: "INVALID_URL"; message: string }
  | { type: "MULTIPLE_FILE_KEYS"; groups: { fileKey: string; urls: string[] }[] }
  | { type: "CUSTOM_ERROR"; message: string };

/** AppError から人間向けのメッセージを生成する */
export function formatError(error: AppError): string {
  switch (error.type) {
    case "CONFIG_READ_ERROR":
      return "Failed to read the config file";
    case "CONFIG_WRITE_ERROR":
      return "Failed to write the config file";
    case "API_ERROR":
      // 403 はトークン起因の可能性が高いため、リトライ手順のヒントを添える
      // （スキル未導入のエージェントが失敗時に確実に見るのはこのメッセージだけ）
      if (error.status === 403) {
        return `Figma API error (403): ${error.message}. Run \`figma-reader auth list\` to see saved profiles and retry with \`--profile <name>\` to use a different token`;
      }
      // Figma API はファイルの存在を秘匿するため、権限不足でも 403 ではなく 404 を返す。
      // node-id の誤りと区別できないので二段構えのヒントにする
      if (error.status === 404) {
        return `Figma API error (404): ${error.message}. Verify the node-id in the URL. If it is correct, the token may lack access: run \`figma-reader auth list\` to see saved profiles and retry with \`--profile <name>\` to use a different token`;
      }
      return `Figma API error (${error.status}): ${error.message}`;
    // 原因（errno）と回復手段を必ず載せる。NETWORK_ERROR は多くの呼び出し元から出るため、
    // 呼び出し元ごとに案内を組み立てさせず、ここに集約する
    case "NETWORK_ERROR": {
      const message = `A network error occurred (${getErrnoCode(error.cause)})`;
      const hint = proxyHint();
      return hint === undefined ? message : `${message}. ${hint}`;
    }
    case "UNAUTHENTICATED":
      return "No token is configured. Run `figma-reader auth login`";
    case "TOKEN_NOT_FOUND":
      return error.message;
    case "INVALID_URL":
      return `Invalid Figma URL: ${error.message}`;
    // URL は列挙しない。10 本渡されたときに error が数百文字になり、ログと
    // エージェントのコンテキストを圧迫する。内訳は groups（pretty では追加行）に置く
    case "MULTIPLE_FILE_KEYS":
      return `The given URLs span ${error.groups.length} different Figma files; one request can cover only one file. No API call was made, so no rate limit budget was spent. Re-run once per file — the breakdown of which URL belongs to which file accompanies this error (the 'groups' field in JSON output)`;
    case "CUSTOM_ERROR":
      return error.message;
  }
}

/**
 * エラーを stderr に出力する。デフォルトは JSON、pretty で人間向けテキスト。
 * hint は失敗そのものではなく回復手段を伝えるための任意の追記
 */
export function outputError(pretty: boolean, error: AppError, hint?: string): void {
  const message = formatError(error);

  if (pretty) {
    console.error(message);
    if (error.type === "API_ERROR" && error.retryAfter !== undefined) {
      console.error(`Retry after ${error.retryAfter} seconds`);
    }
    // pretty では JSON の追加フィールドが読めないため、内訳を行として展開する
    if (error.type === "MULTIPLE_FILE_KEYS") {
      for (const group of error.groups) {
        console.error(`  ${group.fileKey}: ${group.urls.join(", ")}`);
      }
    }
    if (hint !== undefined) {
      console.error(hint);
    }
  } else {
    const json = {
      success: false,
      error: message,
      ...(error.type === "API_ERROR" &&
        error.retryAfter !== undefined && { retryAfter: error.retryAfter }),
      ...(error.type === "MULTIPLE_FILE_KEYS" && { groups: error.groups }),
      ...(hint !== undefined && { hint }),
    };
    console.error(JSON.stringify(json));
  }
}

/** cause を辿る深さの上限。循環参照で止まらなくなるのを防ぐためだけの値 */
const MAX_CAUSE_DEPTH = 5;

/** errno 風のオブジェクトから code を読む。Error インスタンスに限らない（モックや別 realm でも読める） */
function readErrnoCode(value: unknown): string | undefined {
  return typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string"
    ? value.code
    : undefined;
}

/** 投げられた値から errno のコード（EPERM など）を取り出す。取り出せなければ "unknown" */
export function getErrnoCode(cause: unknown): string {
  // fetch の失敗は TypeError: fetch failed の下に undici のエラーが重なる。
  // 層の数は失敗の種類で変わり（名前解決の失敗は 1 段、プロキシが CONNECT を
  // 拒否した場合は 2 段）、途中の層は code に数値の 0 を持つことがあるため、
  // 文字列の code が見つかるまで辿る。上限は循環した cause で止まらなくなるのを防ぐ
  let current = cause;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth++) {
    const code = readErrnoCode(current);
    if (code !== undefined) {
      return code;
    }
    if (typeof current !== "object" || current === null || !("cause" in current)) {
      break;
    }
    current = current.cause;
  }
  return "unknown";
}
