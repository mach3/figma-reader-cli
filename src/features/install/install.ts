import { cp, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "../../lib/error.js";

/**
 * エージェント名 → スキルのインストール先（cwd からの相対パス）。
 * どのエージェントも SKILL.md 形式をそのまま読めるため、変換は不要。
 */
const AGENT_TARGETS: Record<string, string> = {
  claude: ".claude/skills/figma-reader-cli",
  // Codex CLI と Antigravity はどちらもリポジトリスコープのスキルを .agents/ 配下から探すため
  // 同じパスに解決される。Codex の ~/.codex/skills はユーザースコープ専用でリポジトリでは読まれず、
  // Antigravity の rules/workflows が使う単数形の .agent/ ともディレクトリが異なる
  codex: ".agents/skills/figma-reader-cli",
  antigravity: ".agents/skills/figma-reader-cli",
};

/** インストール先として指定できるエージェント名 */
export const AGENT_NAMES = Object.keys(AGENT_TARGETS);

/** インストール先の解決に使うオプション。どちらも未指定なら claude 扱い */
export type ResolveInstallDirOptions = {
  cwd: string;
  agent?: string;
  dest?: string;
};

/** --agent / --dest からインストール先の絶対パスを解決する */
export function resolveInstallDir({
  cwd,
  agent,
  dest,
}: ResolveInstallDirOptions): Result<string, AppError> {
  if (agent !== undefined && dest !== undefined) {
    return err({
      type: "CUSTOM_ERROR",
      message: "--agent and --dest cannot be used together",
    });
  }

  if (dest !== undefined) {
    const trimmed = dest.trim();
    // citty は値なしの --dest を空文字にし、後続トークンがフラグでもそのまま値として吸い込む。
    // 素通しすると `--dest --pretty` が cwd 直下に `--pretty` というディレクトリを作ってしまう
    if (trimmed === "" || trimmed.startsWith("-")) {
      return err({ type: "CUSTOM_ERROR", message: "--dest requires a path" });
    }
    // join と違い resolve は絶対パスの dest をそのまま採用する
    const resolved = resolve(cwd, dest);
    // `.` などで cwd 自身を指されるとスキルがプロジェクト直下に展開され、
    // 同名ファイルを黙って上書きしたうえで成功を返してしまう
    if (resolved === resolve(cwd)) {
      return err({
        type: "CUSTOM_ERROR",
        message: "--dest must not be the current directory",
      });
    }
    return ok(resolved);
  }

  const name = agent ?? "claude";
  if (!Object.hasOwn(AGENT_TARGETS, name)) {
    return err({
      type: "CUSTOM_ERROR",
      message: `--agent must be one of: ${AGENT_NAMES.join(", ")}`,
    });
  }
  return ok(join(cwd, AGENT_TARGETS[name]));
}

/**
 * インストール先を出力用に整形する。cwd 配下なら相対パス、外なら絶対パス。
 * `--dest` で cwd の外を指したときに `../../..` を返すと、受け取ったエージェントが
 * cwd を知らない限り解釈できないため
 */
export function formatInstalledPath(cwd: string, destDir: string): string {
  const rel = relative(cwd, destDir);
  return rel.startsWith("..") || isAbsolute(rel) ? destDir : rel;
}

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
