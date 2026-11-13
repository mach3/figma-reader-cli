import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppError, formatError, getErrnoCode, outputError } from "./error.js";

const multipleFileKeys: AppError = {
  type: "MULTIPLE_FILE_KEYS",
  groups: [
    { fileKey: "ABC123", urls: ["https://www.figma.com/design/ABC123/F?node-id=1-2"] },
    { fileKey: "XYZ789", urls: ["https://www.figma.com/design/XYZ789/G?node-id=3-4"] },
  ],
};

describe("formatError", () => {
  // 10 本渡されたときに error が数百文字になるのを避けるため、URL は文字列に載せない
  it("MULTIPLE_FILE_KEYS のメッセージに URL を列挙しない", () => {
    const message = formatError(multipleFileKeys);

    expect(message).not.toContain("figma.com");
    expect(message).toContain("2 different Figma files");
    expect(message).toContain("groups");
  });

  // レートリミットと取り違えて作業を止めないよう、予算未消費であることを必ず伝える
  it("MULTIPLE_FILE_KEYS のメッセージが API を呼んでいないことを伝える", () => {
    expect(formatError(multipleFileKeys)).toContain("No API call was made");
  });
});

// 開発環境・CI ともにプロキシ変数が設定されていることがあるため、各ケースで明示的に落とす
function clearProxyEnv(): void {
  for (const name of [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NODE_USE_ENV_PROXY",
  ]) {
    vi.stubEnv(name, undefined);
  }
}

const fetchFailure = new TypeError("fetch failed", {
  cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.figma.com"), { code: "ENOTFOUND" }),
});

describe("formatError の NETWORK_ERROR", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // 原因が分からないと、利用者は許可漏れ・名前解決・証明書のどれを疑えばよいか判断できない
  it("errno をメッセージに載せる", () => {
    clearProxyEnv();

    expect(formatError({ type: "NETWORK_ERROR", cause: fetchFailure })).toBe(
      "A network error occurred (ENOTFOUND)",
    );
  });

  it("errno を取り出せないときは unknown にする", () => {
    clearProxyEnv();

    expect(formatError({ type: "NETWORK_ERROR", cause: new Error("boom") })).toBe(
      "A network error occurred (unknown)",
    );
  });

  // enableProxyFromEnv を通さずに呼ぶため、適用結果が未確定の状態を通る。
  // どの案内が出るかはそこと Node のバージョン次第なので、連結の書式だけを固定する
  it("プロキシ環境変数があるときは案内を続ける", () => {
    clearProxyEnv();
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:8080");

    const message = formatError({ type: "NETWORK_ERROR", cause: fetchFailure });

    expect(message).toMatch(/^A network error occurred \(ENOTFOUND\)\. .+/);
  });
});

describe("outputError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MULTIPLE_FILE_KEYS の JSON に groups を含める", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(false, multipleFileKeys);

    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({
      success: false,
      error: formatError(multipleFileKeys),
      groups: multipleFileKeys.type === "MULTIPLE_FILE_KEYS" ? multipleFileKeys.groups : undefined,
    });
  });

  it("pretty では fileKey ごとに内訳を 1 行ずつ出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(true, multipleFileKeys);

    const lines = spy.mock.calls.map((call) => call[0]);
    expect(lines).toEqual([
      formatError(multipleFileKeys),
      "  ABC123: https://www.figma.com/design/ABC123/F?node-id=1-2",
      "  XYZ789: https://www.figma.com/design/XYZ789/G?node-id=3-4",
    ]);
  });

  it("MULTIPLE_FILE_KEYS 以外の JSON に groups を足さない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(false, { type: "INVALID_URL", message: "Malformed URL" });

    expect(JSON.parse(spy.mock.calls[0][0] as string)).not.toHaveProperty("groups");
  });
});

describe("getErrnoCode", () => {
  it("code 文字列を持つオブジェクトならその値を返す", () => {
    expect(getErrnoCode(Object.assign(new Error("x"), { code: "ENOSPC" }))).toBe("ENOSPC");
    expect(getErrnoCode({ code: "EACCES" })).toBe("EACCES");
  });

  // Node の fetch は外側に TypeError: fetch failed を投げ、errno は 1 段内側の cause にある
  it("直下に code が無ければ cause を 1 段だけ辿る", () => {
    expect(getErrnoCode(fetchFailure)).toBe("ENOTFOUND");
  });

  it("直下の code を cause より優先する", () => {
    const nested = Object.assign(new Error("x"), {
      code: "EPERM",
      cause: { code: "ENOTFOUND" },
    });

    expect(getErrnoCode(nested)).toBe("EPERM");
  });

  // プロキシが CONNECT を拒否したとき（issue #40 が対象とする失敗そのもの）は
  // 2 段ネストし、途中の層は code に数値の 0 を持つ。実際の値で固定する
  it("途中の層が数値の code を持っていても文字列の code まで辿る", () => {
    const proxyRejected = new TypeError("fetch failed", {
      cause: Object.assign(new Error("Request was cancelled."), {
        code: 0,
        cause: Object.assign(new Error("Proxy response (403) !== 200 when HTTP Tunneling"), {
          code: "UND_ERR_ABORTED",
        }),
      }),
    });

    expect(getErrnoCode(proxyRejected)).toBe("UND_ERR_ABORTED");
  });

  it("循環した cause でも止まる", () => {
    const looping: { cause?: unknown } = {};
    looping.cause = looping;

    expect(getErrnoCode(looping)).toBe("unknown");
  });

  it.each([new Error("x"), null, "EPERM", { code: 1 }])("%o なら unknown を返す", (cause) => {
    expect(getErrnoCode(cause)).toBe("unknown");
  });
});
