import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addToken,
  getConfigPath,
  normalizeConfig,
  readConfig,
  resolveToken,
  switchToken,
  writeConfig,
} from "./config.js";

describe("getConfigPath", () => {
  it("~/.config/figma-reader/config.json を返す", () => {
    expect(getConfigPath()).toBe(join(homedir(), ".config", "figma-reader", "config.json"));
  });
});

describe("normalizeConfig", () => {
  it("旧形式 {token} を tokens.default に変換する", () => {
    const result = normalizeConfig({ token: "figd_legacy" });
    expect(result).toEqual({ tokens: { default: "figd_legacy" }, activeToken: "default" });
  });

  it("新形式はそのまま返す", () => {
    const config = { tokens: { work: "figd_work" }, activeToken: "work" };
    expect(normalizeConfig(config)).toEqual(config);
  });

  it("tokens があれば旧形式の token は無視する", () => {
    const result = normalizeConfig({
      token: "figd_legacy",
      tokens: { work: "figd_work" },
      activeToken: "work",
    });
    expect(result).toEqual({ tokens: { work: "figd_work" }, activeToken: "work" });
  });

  it("空の Config は空の tokens を返す", () => {
    expect(normalizeConfig({})).toEqual({ tokens: {}, activeToken: undefined });
  });
});

describe("addToken", () => {
  it("最初のトークン追加時は自動でアクティブにする", () => {
    const result = addToken({ tokens: {} }, "personal", "figd_a");
    expect(result).toEqual({ tokens: { personal: "figd_a" }, activeToken: "personal" });
  });

  it("2つ目以降の追加ではアクティブを変更しない", () => {
    const result = addToken(
      { tokens: { personal: "figd_a" }, activeToken: "personal" },
      "work",
      "figd_b",
    );
    expect(result).toEqual({
      tokens: { personal: "figd_a", work: "figd_b" },
      activeToken: "personal",
    });
  });

  it("同名のトークンは黙って上書きする", () => {
    const result = addToken(
      { tokens: { personal: "figd_old" }, activeToken: "personal" },
      "personal",
      "figd_new",
    );
    expect(result).toEqual({ tokens: { personal: "figd_new" }, activeToken: "personal" });
  });
});

describe("switchToken", () => {
  const config = { tokens: { personal: "figd_a", work: "figd_b" }, activeToken: "personal" };

  it("存在する名前に切り替えられる", () => {
    const result = switchToken(config, "work");
    expect(result._unsafeUnwrap().activeToken).toBe("work");
  });

  it("継承キー（toString 等）は存在扱いにしない", () => {
    // JSON.parse 由来のオブジェクトは Object.prototype を継承しているため in 演算子では誤判定する
    const result = switchToken({ tokens: JSON.parse("{}") }, "toString");
    expect(result._unsafeUnwrapErr().type).toBe("TOKEN_NOT_FOUND");
  });

  it("存在しない名前は TOKEN_NOT_FOUND を返し、保存済み一覧を含む", () => {
    const result = switchToken(config, "nonexistent");
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("TOKEN_NOT_FOUND");
    if (error.type === "TOKEN_NOT_FOUND") {
      expect(error.message).toContain("personal");
      expect(error.message).toContain("work");
    }
  });
});

describe("readConfig / writeConfig / resolveToken (実ファイル I/O)", () => {
  const testDir = join(tmpdir(), `figma-reader-config-test-${Date.now()}`);
  const configPath = join(testDir, "config.json");

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(testDir, { recursive: true, force: true });
  });

  it("ファイルが存在しない場合は空の正規化済み Config を返す", async () => {
    const result = await readConfig(configPath);
    expect(result._unsafeUnwrap()).toEqual({ tokens: {}, activeToken: undefined });
  });

  it("書き込んだ Config を読み戻せる", async () => {
    const config = { tokens: { work: "figd_w" }, activeToken: "work" };
    await writeConfig(config, configPath);
    const result = await readConfig(configPath);
    expect(result._unsafeUnwrap()).toEqual(config);
  });

  it("writeConfig はディレクトリを自動作成し、渡した内容をそのまま永続化する", async () => {
    const config = { tokens: { work: "figd_w" }, activeToken: "work" };
    const result = await writeConfig(config, configPath);
    expect(result.isOk()).toBe(true);

    const content = await readFile(configPath, "utf-8");
    expect(JSON.parse(content)).toEqual(config);
  });

  it("旧形式のファイルは読み込み時に正規化される", async () => {
    await writeConfig({ token: "figd_legacy" }, configPath);
    const result = await readConfig(configPath);
    expect(result._unsafeUnwrap()).toEqual({
      tokens: { default: "figd_legacy" },
      activeToken: "default",
    });
  });

  it("resolveToken は環境変数 FIGMA_TOKEN を最優先する", async () => {
    vi.stubEnv("FIGMA_TOKEN", "figd_env");
    await writeConfig({ tokens: { work: "figd_w" }, activeToken: "work" }, configPath);
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrap()).toBe("figd_env");
  });

  it("resolveToken は tokens[activeToken] を返す", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    await writeConfig(
      { tokens: { personal: "figd_p", work: "figd_w" }, activeToken: "work" },
      configPath,
    );
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrap()).toBe("figd_w");
  });

  it("activeToken の指す先が存在しない場合は UNAUTHENTICATED", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    await writeConfig({ tokens: { personal: "figd_p" }, activeToken: "deleted" }, configPath);
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrapErr().type).toBe("UNAUTHENTICATED");
  });

  it("activeToken が継承キー（toString 等）でもクラッシュせず UNAUTHENTICATED", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    await writeConfig({ tokens: {}, activeToken: "toString" }, configPath);
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrapErr().type).toBe("UNAUTHENTICATED");
  });

  it("トークンが何もない場合は UNAUTHENTICATED", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrapErr().type).toBe("UNAUTHENTICATED");
  });

  it("旧形式ファイルからも resolveToken できる", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    await writeConfig({ token: "figd_legacy" }, configPath);
    const result = await resolveToken(configPath);
    expect(result._unsafeUnwrap()).toBe("figd_legacy");
  });
});
