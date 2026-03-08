/** アプリケーション全体で使う共通エラー型 */
export type AppError =
  | { type: "CONFIG_READ_ERROR"; cause: unknown }
  | { type: "CONFIG_WRITE_ERROR"; cause: unknown }
  | { type: "API_ERROR"; status: number; message: string; retryAfter?: number }
  | { type: "NETWORK_ERROR"; cause: unknown }
  | { type: "UNAUTHENTICATED" }
  | { type: "INVALID_URL"; message: string }
  | { type: "CUSTOM_ERROR"; message: string };

/** AppError から人間向けのメッセージを生成する */
export function formatError(error: AppError): string {
  switch (error.type) {
    case "CONFIG_READ_ERROR":
      return "設定ファイルの読み込みに失敗しました";
    case "CONFIG_WRITE_ERROR":
      return "設定ファイルの書き込みに失敗しました";
    case "API_ERROR": {
      const base = `Figma API エラー (${error.status}): ${error.message}`;
      if (error.retryAfter !== undefined) {
        return `${base}（${error.retryAfter} 秒後にリトライしてください）`;
      }
      return base;
    }
    case "NETWORK_ERROR":
      return "ネットワークエラーが発生しました";
    case "UNAUTHENTICATED":
      return "トークンが設定されていません。`figma-reader login` を実行してください";
    case "INVALID_URL":
      return `無効な Figma URL です: ${error.message}`;
    case "CUSTOM_ERROR":
      return error.message;
  }
}

/** エラーを stderr に出力する。デフォルトは JSON、pretty で人間向けテキスト */
export function outputError(pretty: boolean, error: AppError): void {
  const message = formatError(error);

  if (pretty) {
    console.error(message);
  } else {
    const json =
      error.type === "API_ERROR" && error.retryAfter !== undefined
        ? { success: false, error: message, retryAfter: error.retryAfter }
        : { success: false, error: message };
    console.error(JSON.stringify(json));
  }
}
