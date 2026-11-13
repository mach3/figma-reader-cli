import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 開発環境・CI ともにプロキシ変数が設定されていることがあるため、
 * 各ケースで 6 変数すべてを明示的に未設定へ落としてから必要なものだけ立てる。
 * 怠ると実環境の値が紛れ込み、判定を検証できない
 */
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

/**
 * node:http を差し替えたうえで proxy.ts を読み直す。
 * setGlobalProxyFromEnv の有無はモジュールの形そのものなので、
 * typeof による機能検出を検証するには読み直しが要る。
 * loaded はモジュールが実際に読み込まれた回数で、遅延読み込みの検証に使う
 */
async function loadProxy(hasApi: boolean, throws?: Error) {
  vi.resetModules();
  const setGlobalProxyFromEnv = vi.fn(() => {
    if (throws) {
      throw throws;
    }
  });
  const loaded = { count: 0 };
  // API 非搭載側でもキー自体は置く。vitest はモックに無いキーへのアクセスを
  // 例外にするため、キーごと省くと typeof の判定まで到達しない
  vi.doMock("node:http", () => {
    loaded.count += 1;
    return { setGlobalProxyFromEnv: hasApi ? setGlobalProxyFromEnv : undefined };
  });
  const mod = await import("./proxy.js");
  return { ...mod, setGlobalProxyFromEnv, loaded };
}

afterEach(() => {
  vi.doUnmock("node:http");
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe("enableProxyFromEnv", () => {
  it("API がある Node では setGlobalProxyFromEnv を呼ぶ", async () => {
    clearProxyEnv();
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:8080");
    const { enableProxyFromEnv, setGlobalProxyFromEnv } = await loadProxy(true);

    await expect(enableProxyFromEnv()).resolves.toBe(true);
    expect(setGlobalProxyFromEnv).toHaveBeenCalledTimes(1);
  });

  // engines は実行を止めないため、API を持たない Node でも落ちてはいけない
  it("API が無い Node では呼ばず、例外も投げない", async () => {
    clearProxyEnv();
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:8080");
    const { enableProxyFromEnv, setGlobalProxyFromEnv } = await loadProxy(false);

    await expect(enableProxyFromEnv()).resolves.toBe(false);
    expect(setGlobalProxyFromEnv).not.toHaveBeenCalled();
  });

  // node:http は読むだけで CLI の起動が約 7ms 伸びる。
  // プロキシを使わない利用者にその分を払わせない
  it("プロキシ環境変数が無ければ node:http を読み込まない", async () => {
    clearProxyEnv();
    const { enableProxyFromEnv, loaded } = await loadProxy(true);

    await expect(enableProxyFromEnv()).resolves.toBe(false);
    expect(loaded.count).toBe(0);
  });

  it("空白のみの値は未設定として扱う", async () => {
    clearProxyEnv();
    vi.stubEnv("HTTPS_PROXY", "   ");
    const { enableProxyFromEnv, loaded } = await loadProxy(true);

    await expect(enableProxyFromEnv()).resolves.toBe(false);
    expect(loaded.count).toBe(0);
  });

  // Node の組み込みプロキシは ALL_PROXY と SOCKS を読まない。
  // これを設定済みとみなすと、効きもしない変数を根拠に動くことになる
  it("ALL_PROXY だけでは有効化しない", async () => {
    clearProxyEnv();
    vi.stubEnv("ALL_PROXY", "socks5://127.0.0.1:1080");
    const { enableProxyFromEnv, loaded } = await loadProxy(true);

    await expect(enableProxyFromEnv()).resolves.toBe(false);
    expect(loaded.count).toBe(0);
  });
});

describe("proxyHint", () => {
  it("プロキシ環境変数が無ければ案内しない", async () => {
    clearProxyEnv();
    const { enableProxyFromEnv, proxyHint } = await loadProxy(true);
    await enableProxyFromEnv();

    expect(proxyHint()).toBeUndefined();
  });

  it("ALL_PROXY だけでは案内しない", async () => {
    clearProxyEnv();
    vi.stubEnv("ALL_PROXY", "socks5://127.0.0.1:1080");
    const { enableProxyFromEnv, proxyHint } = await loadProxy(true);
    await enableProxyFromEnv();

    expect(proxyHint()).toBeUndefined();
  });

  it("プロキシを適用できたときは許可すべきホストを案内する", async () => {
    clearProxyEnv();
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example:8080");
    const { enableProxyFromEnv, proxyHint } = await loadProxy(true);
    await enableProxyFromEnv();

    const hint = proxyHint();
    expect(hint).toContain("api.figma.com");
    expect(hint).toContain("NO_PROXY");
  });

  // 値が不正なときに throw させると、ネットワークに触れない --help や install まで
  // 生のスタックトレースで落ちる。案内に差し替えて動き続けることを固定する
  it("値が不正で適用できなかったときは、落とさずに書式を案内する", async () => {
    clearProxyEnv();
    vi.stubEnv("HTTP_PROXY", "127.0.0.1:8080");
    const invalid = Object.assign(new Error("127.0.0.1:8080"), {
      code: "ERR_PROXY_INVALID_CONFIG",
    });
    const { enableProxyFromEnv, proxyHint } = await loadProxy(true, invalid);

    await expect(enableProxyFromEnv()).resolves.toBe(false);
    const hint = proxyHint();
    expect(hint).toContain("ERR_PROXY_INVALID_CONFIG");
    expect(hint).toContain("http://host:port");
  });

  // NODE_USE_ENV_PROXY=1 なら Node 自身が適用済みなので、設定しろという案内は誤り
  it("NODE_USE_ENV_PROXY=1 のときは Node の更新を案内しない", async () => {
    clearProxyEnv();
    vi.stubEnv("http_proxy", "http://proxy.example:8080");
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const { enableProxyFromEnv, proxyHint } = await loadProxy(false);
    await enableProxyFromEnv();

    const hint = proxyHint();
    expect(hint).not.toContain("NODE_USE_ENV_PROXY");
    expect(hint).toContain("api.figma.com");
  });

  // 変数が立っていても読まない Node では何も起きない。設定済みとみなすと
  // 唯一の対処である Node の更新が案内から消える
  it("NODE_USE_ENV_PROXY を読まない Node では無視する", async () => {
    clearProxyEnv();
    vi.stubEnv("http_proxy", "http://proxy.example:8080");
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    const original = process.versions.node;
    Object.defineProperty(process.versions, "node", {
      value: "22.12.0",
      configurable: true,
    });

    try {
      const { enableProxyFromEnv, proxyHint } = await loadProxy(false);
      await enableProxyFromEnv();

      expect(proxyHint()).toContain("24.14");
    } finally {
      Object.defineProperty(process.versions, "node", {
        value: original,
        configurable: true,
      });
    }
  });

  it("適用できなかったときは Node の更新と NODE_USE_ENV_PROXY を案内する", async () => {
    clearProxyEnv();
    vi.stubEnv("http_proxy", "http://proxy.example:8080");
    const { enableProxyFromEnv, proxyHint } = await loadProxy(false);
    await enableProxyFromEnv();

    const hint = proxyHint();
    expect(hint).toContain("24.14");
    expect(hint).toContain("NODE_USE_ENV_PROXY=1");
  });
});
