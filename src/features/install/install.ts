import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "../../lib/error.js";

/** バンドル済みスキルファイルのソースディレクトリを返す */
export function getSkillSourceDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..", "skills", "figma-reader-cli");
}

/** スキルファイルをインストール先にコピーする */
export async function copySkills(
  sourceDir: string,
  destDir: string,
): Promise<Result<void, AppError>> {
  try {
    await mkdir(destDir, { recursive: true });
    await cp(sourceDir, destDir, { recursive: true });
    return ok(undefined);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return err({ type: "CUSTOM_ERROR", message: `Failed to install skills: ${detail}` });
  }
}
