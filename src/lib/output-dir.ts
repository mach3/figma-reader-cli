import { err, ok, type Result } from "neverthrow";
import type { AppError } from "./error.js";

/**
 * inspect / export の `--output <dir>` の値を検証し、trim 済みの値を返す。
 * 両コマンドで同じ値を同じ規則で弾くため、ここに一本化する（呼び出し側は戻り値を使い、生の値でパスを作らない）。
 *
 * - citty は値なしの --output を ""、`--no-output` を false にし、後続トークンがフラグでも
 *   値として吸い込む（`--output --pretty` は output:"--pretty"）。素通しすると `--pretty` という
 *   ディレクトリが作られるうえ、吸い込まれたフラグも効かない
 * - 引用符で囲まれた `~` はシェルが展開しない。素通しすると cwd に `~` というディレクトリが作られる。
 *   弾くのは `~` と `~/` で始まるものだけで、`~drafts` のような普通の名前は通す
 */
export function checkOutputDir(output: string | boolean | undefined): Result<string, AppError> {
  const value = typeof output === "string" ? output.trim() : "";
  if (value === "" || value.startsWith("-")) {
    return err({ type: "CUSTOM_ERROR", message: "--output requires a directory" });
  }
  if (value === "~" || value.startsWith("~/")) {
    return err({
      type: "CUSTOM_ERROR",
      message: `--output does not expand "~"; got ${JSON.stringify(value)}. Pass an absolute path or a path relative to the current directory`,
    });
  }
  return ok(value);
}
