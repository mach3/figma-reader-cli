import { describe, expect, it } from "vitest";
import { checkOutputDir } from "./output-dir.js";

describe("checkOutputDir", () => {
  it("trim 済みの値を返す", () => {
    expect(checkOutputDir("  ./out ")._unsafeUnwrap()).toBe("./out");
  });

  // `~` 始まりでも展開と無関係な普通の名前は通す
  it.each(["~drafts", "out/~x", "/abs/dir"])("%o は通す", (output) => {
    expect(checkOutputDir(output).isOk()).toBe(true);
  });

  // citty は値なしの --output を ""、`--no-output` を false にし、後続のフラグも値として吸い込む
  it.each(["", "   ", "--pretty", "-x", false, true])(
    "%o はディレクトリなしとしてエラーを返す",
    (output) => {
      expect(checkOutputDir(output)._unsafeUnwrapErr()).toEqual({
        type: "CUSTOM_ERROR",
        message: "--output requires a directory",
      });
    },
  );

  // 引用符で囲まれた ~ はシェルが展開せず、通すと cwd に `~` というディレクトリが作られる
  it.each([
    ["~", "~"],
    ["~/figma-out", "~/figma-out"],
    [" ~/x", "~/x"],
  ])("%o は ~ を展開しない旨のエラーを返す", (output, shown) => {
    expect(checkOutputDir(output)._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: `--output does not expand "~"; got "${shown}". Pass an absolute path or a path relative to the current directory`,
    });
  });
});
