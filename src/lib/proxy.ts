/**
 * Node の組み込みプロキシが実際に読む環境変数。
 * ALL_PROXY / SOCKS は Node が読まないため、ここに含めない
 * （含めると「プロキシ設定済み」と誤判定し、的外れな案内を出す）
 */
const PROXY_ENV_VARS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"] as const;

/**
 * 起動時のプロキシ適用の結果。案内文はこの 1 つの事実から導く
 * （同じ判定を 2 か所でやり直すと、実際の適用状況とメッセージが黙ってずれる）。
 * unknown は enableProxyFromEnv がまだ走っていない状態
 */
type ProxyState =
  | { kind: "unknown" }
  | { kind: "applied" }
  /** プロキシ環境変数が無く、適用するものが無かった */
  | { kind: "not-configured" }
  /** この Node が setGlobalProxyFromEnv を持たない */
  | { kind: "unavailable" }
  /** 値が不正で適用できなかった */
  | { kind: "invalid"; code: string };

let proxyState: ProxyState = { kind: "unknown" };

/**
 * NODE_USE_ENV_PROXY=1 での起動かどうか。これが立っていれば Node 自身が
 * 起動時にプロキシを適用済みで、setGlobalProxyFromEnv の有無とは無関係に通信は通る
 */
function usesEnvProxyFlag(): boolean {
  if (process.env.NODE_USE_ENV_PROXY?.trim() !== "1") {
    return false;
  }
  // 変数が立っていても、読む Node でなければ何も起きない。
  // 設定済みとみなすと「プロキシ経由で通信している」と誤って案内し、
  // 唯一の対処である Node の更新を隠してしまう
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return major >= 24 || (major === 22 && minor >= 21);
}

/**
 * throw された値から code を読む。error.ts の getErrnoCode は使わない
 * （error.ts がこのモジュールを import しており、循環参照になる）
 */
function errorCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "unknown";
}

/** プロキシ環境変数が 1 つでも設定されているか。空文字・空白のみは未設定として扱う */
function hasProxyEnv(): boolean {
  return PROXY_ENV_VARS.some((name) => (process.env[name]?.trim() ?? "") !== "");
}

/**
 * NO_PROXY が Figma を除外していそうか。
 * サフィックス・ポート・ワイルドカードの完全な照合はしない（この案内に見合わない）。
 * 目的は、すでに NO_PROXY を設定している利用者へ「NO_PROXY に足せ」と
 * 逆向きの対処を勧めないことだけ
 */
function noProxyNamesFigma(): boolean {
  return ["NO_PROXY", "no_proxy"].some((name) => {
    const value = process.env[name]?.trim() ?? "";
    return value === "*" || value.includes("figma.com");
  });
}

/**
 * プロキシ環境変数を Node のグローバルエージェントと undici のディスパッチャに反映する。
 * 適用できたかどうかを返す。
 *
 * Node の組み込み fetch は既定でプロキシ環境変数を読まないため、これを呼ばないと
 * プロキシ必須の環境（エージェントの sandbox など）で全リクエストが失敗する。
 *
 * node:http は読み込むだけで CLI の起動が約 7ms（約 29%）伸びるため、
 * 静的 import にせず、プロキシ環境変数があるときだけ読む。
 * 変数が無いとき setGlobalProxyFromEnv は何も差し替えないので、挙動は変わらない
 */
export async function enableProxyFromEnv(): Promise<boolean> {
  if (!hasProxyEnv()) {
    proxyState = { kind: "not-configured" };
    return false;
  }

  // setGlobalProxyFromEnv は Node 24.14 / 25.4 で追加された。
  // engines は実行を止めないため、下限未満の Node で動くことを前提に確認する
  const http = await import("node:http");
  if (typeof http.setGlobalProxyFromEnv !== "function") {
    proxyState = { kind: "unavailable" };
    return false;
  }

  try {
    http.setGlobalProxyFromEnv();
  } catch (error: unknown) {
    // スキームの無い `host:port`（curl は受け付ける書式）などで throw する。
    // ここで落とすと、ネットワークに触れない --help や install まで
    // 生のスタックトレースで終了し、機械可読なエラーという約束が崩れる
    proxyState = { kind: "invalid", code: errorCode(error) };
    return false;
  }

  proxyState = { kind: "applied" };
  return true;
}

/**
 * ネットワークエラー時に添える回復手段の案内。
 * プロキシ環境変数が無い環境では案内する内容が無いため undefined を返す
 */
export function proxyHint(): string | undefined {
  if (!hasProxyEnv()) {
    return undefined;
  }
  if (proxyState.kind === "invalid") {
    return `Proxy environment variables are set, but could not be applied (${proxyState.code}). Check HTTP_PROXY and HTTPS_PROXY: the value needs a scheme, such as http://host:port`;
  }
  // NODE_USE_ENV_PROXY で既に適用済みの利用者に、それを設定しろとは案内しない
  if (proxyState.kind === "unavailable" && !usesEnvProxyFlag()) {
    return `Proxy environment variables are set, but Node ${process.version} cannot apply them automatically. Upgrade to Node 24.14 or later (25.4 or later on the 25 line), or re-run with NODE_USE_ENV_PROXY=1 (Node 22.21 or later)`;
  }
  const base =
    "Requests use the proxy from HTTP_PROXY/HTTPS_PROXY unless NO_PROXY excludes the host. Allow `api.figma.com` in the proxy or sandbox allowlist; `export --download` additionally needs the image host returned by the API, which is not `api.figma.com`";
  return noProxyNamesFigma()
    ? `${base}. NO_PROXY already names Figma, so this request may have bypassed the proxy and failed on a direct connection`
    : `${base}. To keep Figma off the proxy instead, add \`api.figma.com\` to NO_PROXY`;
}
