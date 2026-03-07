/** アプリケーション全体で使う共通エラー型 */
export type AppError =
  | { type: "CONFIG_READ_ERROR"; cause: unknown }
  | { type: "CONFIG_WRITE_ERROR"; cause: unknown }
  | { type: "API_ERROR"; status: number; message: string }
  | { type: "NETWORK_ERROR"; cause: unknown }
  | { type: "UNAUTHENTICATED" }
  | { type: "INVALID_URL"; message: string };

/** AppError から人間向けのメッセージを生成する */
export function formatError(error: AppError): string {
  switch (error.type) {
    case "CONFIG_READ_ERROR":
      return "設定ファイルの読み込みに失敗しました";
    case "CONFIG_WRITE_ERROR":
      return "設定ファイルの書き込みに失敗しました";
    case "API_ERROR":
      return `Figma API エラー (${error.status}): ${error.message}`;
    case "NETWORK_ERROR":
      return "ネットワークエラーが発生しました";
    case "UNAUTHENTICATED":
      return "トークンが設定されていません。`figma-reader login` を実行してください";
    case "INVALID_URL":
      return `無効な Figma URL です: ${error.message}`;
  }
}

/** エラーを stderr に出力する。デフォルトは JSON、pretty で人間向けテキスト */
export function outputError(pretty: boolean, message: string): void {
  if (pretty) {
    console.error(message);
  } else {
    console.error(JSON.stringify({ success: false, error: message }));
  }
}
