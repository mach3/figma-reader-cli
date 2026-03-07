/** アプリケーション全体で使う共通エラー型 */
export type AppError =
  | { type: "CONFIG_READ_ERROR"; cause: unknown }
  | { type: "CONFIG_WRITE_ERROR"; cause: unknown }
  | { type: "API_ERROR"; status: number; message: string }
  | { type: "NETWORK_ERROR"; cause: unknown }
  | { type: "UNAUTHENTICATED" };

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
  }
}

/** JSON / テキスト形式でエラーを stderr に出力する */
export function outputError(json: boolean, message: string): void {
  if (json) {
    console.error(JSON.stringify({ success: false, error: message }));
  } else {
    console.error(message);
  }
}
