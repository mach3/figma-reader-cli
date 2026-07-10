/** アプリケーション全体で使う共通エラー型 */
export type AppError =
  | { type: "CONFIG_READ_ERROR"; cause: unknown }
  | { type: "CONFIG_WRITE_ERROR"; cause: unknown }
  | { type: "API_ERROR"; status: number; message: string; retryAfter?: number }
  | { type: "NETWORK_ERROR"; cause: unknown }
  | { type: "UNAUTHENTICATED" }
  | { type: "TOKEN_NOT_FOUND"; message: string }
  | { type: "INVALID_URL"; message: string }
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
    case "NETWORK_ERROR":
      return "A network error occurred";
    case "UNAUTHENTICATED":
      return "No token is configured. Run `figma-reader auth login`";
    case "TOKEN_NOT_FOUND":
      return error.message;
    case "INVALID_URL":
      return `Invalid Figma URL: ${error.message}`;
    case "CUSTOM_ERROR":
      return error.message;
  }
}

/** エラーを stderr に出力する。デフォルトは JSON、pretty で人間向けテキスト */
export function outputError(pretty: boolean, error: AppError): void {
  const message = formatError(error);

  if (pretty) {
    console.error(message);
    if (error.type === "API_ERROR" && error.retryAfter !== undefined) {
      console.error(`Retry after ${error.retryAfter} seconds`);
    }
  } else {
    const json =
      error.type === "API_ERROR" && error.retryAfter !== undefined
        ? { success: false, error: message, retryAfter: error.retryAfter }
        : { success: false, error: message };
    console.error(JSON.stringify(json));
  }
}
