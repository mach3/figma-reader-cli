import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// homedir をモックして tmpdir 配下を使う
const testHome = join(tmpdir(), `figma-reader-test-${Date.now()}`);
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => testHome };
});

const { readConfig, writeConfig, resolveToken, getConfigPath } = await import(
  "../../src/lib/config.js"
);

describe("config", () => {
  afterEach(async () => {
    await rm(testHome, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("getConfigPath は ~/.config/figma-reader/config.json を返す", () => {
    expect(getConfigPath()).toBe(join(testHome, ".config", "figma-reader", "config.json"));
  });

  describe("readConfig", () => {
    it("ファイルが存在しない場合は空の Config を返す", async () => {
      const result = await readConfig();
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({});
    });

    it("既存の config.json を読み込める", async () => {
      // まず writeConfig でファイルを作る
      await writeConfig({ token: "test-token" });
      const result = await readConfig();
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toEqual({ token: "test-token" });
    });
  });

  describe("writeConfig", () => {
    it("config.json に書き込める", async () => {
      const result = await writeConfig({ token: "new-token" });
      expect(result.isOk()).toBe(true);

      const content = await readFile(getConfigPath(), "utf-8");
      expect(JSON.parse(content)).toEqual({ token: "new-token" });
    });
  });

  describe("resolveToken", () => {
    it("環境変数 FIGMA_TOKEN を優先する", async () => {
      vi.stubEnv("FIGMA_TOKEN", "env-token");
      const result = await resolveToken();
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("env-token");
    });

    it("環境変数がなければ config.json のトークンを使う", async () => {
      vi.stubEnv("FIGMA_TOKEN", "");
      await writeConfig({ token: "file-token" });
      const result = await resolveToken();
      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap()).toBe("file-token");
    });

    it("トークンがどこにもなければ UNAUTHENTICATED エラーを返す", async () => {
      vi.stubEnv("FIGMA_TOKEN", "");
      const result = await resolveToken();
      expect(result.isErr()).toBe(true);
      expect(result._unsafeUnwrapErr()).toEqual({ type: "UNAUTHENTICATED" });
    });
  });
});
