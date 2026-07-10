import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "neverthrow";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeConfig } from "../../lib/config.js";
import { getMe } from "../me/me.js";
import {
  checkStatus,
  listProfiles,
  loginToken,
  maskToken,
  saveToken,
  switchActiveToken,
} from "./auth.js";

vi.mock("../me/me.js", () => ({
  getMe: vi.fn(async () =>
    ok({
      id: "1",
      handle: "Kurisu Makise",
      email: "kurisu.m@example.com",
      img_url: "https://example.com",
    }),
  ),
}));

describe("maskToken", () => {
  it("長いトークンは先頭8文字 + ... にする", () => {
    expect(maskToken("figd_abcdefghijklmn")).toBe("figd_abc...");
  });

  it("短いトークンは全部伏せる", () => {
    expect(maskToken("short")).toBe("***");
  });
});

describe("auth (実ファイル I/O)", () => {
  const testDir = join(tmpdir(), `figma-reader-auth-test-${Date.now()}`);
  const configPath = join(testDir, "config.json");

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(testDir, { recursive: true, force: true });
  });

  it("loginToken は name 未指定なら /v1/me の email ローカル部をプロファイル名にする", async () => {
    const result = await loginToken(undefined, "figd_new_token", configPath);
    expect(result._unsafeUnwrap()).toBe("kurisu.m");

    const profiles = (await listProfiles(configPath))._unsafeUnwrap();
    expect(profiles[0]?.name).toBe("kurisu.m");
  });

  it("loginToken は name 指定時は API を呼ばずに保存する", async () => {
    vi.mocked(getMe).mockClear();
    const result = await loginToken("work", "figd_new_token", configPath);
    expect(result._unsafeUnwrap()).toBe("work");
    expect(getMe).not.toHaveBeenCalled();
  });

  it("saveToken で追加しても既存トークンが消えない", async () => {
    await saveToken("personal", "figd_personal_token", configPath);
    await saveToken("work", "figd_work_token", configPath);

    const result = await listProfiles(configPath);
    const profiles = result._unsafeUnwrap();
    expect(profiles.map((p) => p.name).sort()).toEqual(["personal", "work"]);
    // 初回保存の personal がアクティブのまま
    expect(profiles.find((p) => p.active)?.name).toBe("personal");
  });

  it("switchActiveToken でアクティブを切り替えられる", async () => {
    await saveToken("personal", "figd_personal_token", configPath);
    await saveToken("work", "figd_work_token", configPath);

    const result = await switchActiveToken("work", configPath);
    expect(result.isOk()).toBe(true);

    const profiles = (await listProfiles(configPath))._unsafeUnwrap();
    expect(profiles.find((p) => p.active)?.name).toBe("work");
  });

  it("存在しない名前への切り替えは TOKEN_NOT_FOUND", async () => {
    await saveToken("personal", "figd_personal_token", configPath);

    const result = await switchActiveToken("nonexistent", configPath);
    expect(result._unsafeUnwrapErr().type).toBe("TOKEN_NOT_FOUND");
  });

  it("listProfiles はトークン本体を含まない", async () => {
    await saveToken("personal", "figd_personal_token", configPath);

    const profiles = (await listProfiles(configPath))._unsafeUnwrap();
    expect(JSON.stringify(profiles)).not.toContain("figd_personal_token");
    expect(profiles[0]?.masked).toBe("figd_per...");
  });

  it("旧形式 config からも listProfiles できる", async () => {
    await writeConfig({ token: "figd_legacy_token" }, configPath);

    const profiles = (await listProfiles(configPath))._unsafeUnwrap();
    expect(profiles).toEqual([{ name: "default", masked: "figd_leg...", active: true }]);
  });

  it("checkStatus は config 由来ならアクティブなプロファイル名を返す", async () => {
    vi.stubEnv("FIGMA_TOKEN", "");
    await saveToken("work", "figd_work_token", configPath);

    const result = await checkStatus(undefined, configPath);
    const status = result._unsafeUnwrap();
    expect(status.profile).toBe("work");
    expect(status.user.handle).toBe("Kurisu Makise");
  });

  it("checkStatus は環境変数由来なら profile: env を返す", async () => {
    vi.stubEnv("FIGMA_TOKEN", "figd_env_token");

    const result = await checkStatus(undefined, configPath);
    expect(result._unsafeUnwrap().profile).toBe("env");
  });
});
