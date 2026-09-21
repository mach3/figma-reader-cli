import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySkills, formatInstalledPath, resolveInstallDir } from "./install.js";

describe("resolveInstallDir", () => {
  // 実装は resolve(cwd, dest) を使うため、ドライブレターのないリテラルを渡すと
  // Windows で join ベースの期待値と食い違う。resolve 済みの値を起点にする
  const cwd = resolve("/work/project");

  it("agent 未指定なら .claude 配下に解決する", () => {
    const result = resolveInstallDir({ cwd });

    expect(result._unsafeUnwrap()).toBe(join(cwd, ".claude", "skills", "figma-reader-cli"));
  });

  // codex と antigravity は同じ .agents/ 配下に解決される（どちらもそこを探索するため）
  it.each([
    ["claude", ".claude"],
    ["codex", ".agents"],
    ["antigravity", ".agents"],
  ])("agent=%s は %s 配下に解決する", (agent, dir) => {
    const result = resolveInstallDir({ cwd, agent });

    expect(result._unsafeUnwrap()).toBe(join(cwd, dir, "skills", "figma-reader-cli"));
  });

  it("dest の相対パスは cwd 基準で解決する", () => {
    const result = resolveInstallDir({ cwd, dest: "custom/skills" });

    expect(result._unsafeUnwrap()).toBe(join(cwd, "custom", "skills"));
  });

  it("dest の絶対パスは cwd に依存せずそのまま使う", () => {
    const absolute = resolve("/elsewhere/skills");

    const result = resolveInstallDir({ cwd, dest: absolute });

    expect(result._unsafeUnwrap()).toBe(absolute);
  });

  it("agent と dest の同時指定はエラーを返す", () => {
    const result = resolveInstallDir({ cwd, agent: "codex", dest: "custom/skills" });

    expect(result._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--agent and --dest cannot be used together",
    });
  });

  it("未知の agent 名はエラーを返し、有効な名前を列挙する", () => {
    const result = resolveInstallDir({ cwd, agent: "cursor" });

    expect(result._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: expect.stringContaining("claude, codex, antigravity"),
    });
  });

  // citty は値なしの `--dest` を空文字にし、後続がフラグでもそのまま値にするため、
  // どちらも弾かないと cwd 直下にゴミディレクトリが作られる
  it.each(["", "   ", "--pretty", "-p"])("dest が %o ならエラーを返す", (dest) => {
    const result = resolveInstallDir({ cwd, dest });

    expect(result._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--dest requires a path",
    });
  });

  // cwd 自身を指されるとスキルがプロジェクト直下に展開されてしまう
  it.each([".", "./", "sub/..", cwd])("dest が %o なら cwd 指定としてエラーを返す", (dest) => {
    const result = resolveInstallDir({ cwd, dest });

    expect(result._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--dest must not be the current directory",
    });
  });
});

describe("formatInstalledPath", () => {
  const cwd = resolve("/work/project");

  it("cwd 配下なら相対パスを返す", () => {
    expect(formatInstalledPath(cwd, join(cwd, ".claude", "skills"))).toBe(
      join(".claude", "skills"),
    );
  });

  // cwd 外を `../../..` で返すと、受け取る側が cwd を知らないと解釈できない
  it("cwd 外なら絶対パスをそのまま返す", () => {
    const outside = resolve("/elsewhere/skills");

    expect(formatInstalledPath(cwd, outside)).toBe(outside);
  });
});

describe("copySkills", () => {
  const testDir = join(tmpdir(), `figma-reader-install-test-${Date.now()}`);
  const sourceDir = join(import.meta.dirname, "..", "..", "..", "skills", "figma-reader-cli");

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("スキルファイルをコピーできる", async () => {
    const destDir = join(testDir, ".claude", "skills", "figma-reader-cli");

    const result = await copySkills(sourceDir, destDir);

    expect(result.isOk()).toBe(true);
    expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
    expect(existsSync(join(destDir, "references", "inspect-output.md"))).toBe(true);
  });

  it("コピー先のディレクトリを自動作成する", async () => {
    const destDir = join(testDir, "deep", "nested", "dir");

    const result = await copySkills(sourceDir, destDir);

    expect(result.isOk()).toBe(true);
    expect(existsSync(destDir)).toBe(true);
  });

  it("ソースディレクトリが存在しない場合はエラーを返す", async () => {
    const nonexistentDir = join(testDir, "nonexistent");
    const destDir = join(testDir, "dest");

    const result = await copySkills(nonexistentDir, destDir);

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("CUSTOM_ERROR");
  });

  it("SKILL.md の内容がソースと一致する", async () => {
    const destDir = join(testDir, ".claude", "skills", "figma-reader-cli");

    await copySkills(sourceDir, destDir);

    const srcContent = await readFile(join(sourceDir, "SKILL.md"), "utf-8");
    const dstContent = await readFile(join(destDir, "SKILL.md"), "utf-8");
    expect(dstContent).toBe(srcContent);
  });
});
