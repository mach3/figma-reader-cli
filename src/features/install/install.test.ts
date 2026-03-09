import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copySkills } from "./install.js";

describe("copySkills", () => {
  const testDir = join(tmpdir(), `figma-reader-install-test-${Date.now()}`);
  const sourceDir = join(import.meta.dirname, "..", "..", "..", "skills", "figma-reader");

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("スキルファイルをコピーできる", async () => {
    const destDir = join(testDir, ".claude", "skills", "figma-reader");

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
    const destDir = join(testDir, ".claude", "skills", "figma-reader");

    await copySkills(sourceDir, destDir);

    const srcContent = await readFile(join(sourceDir, "SKILL.md"), "utf-8");
    const dstContent = await readFile(join(destDir, "SKILL.md"), "utf-8");
    expect(dstContent).toBe(srcContent);
  });
});
