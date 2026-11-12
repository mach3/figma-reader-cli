import { type ArgsDef, parseArgs } from "citty";
import { describe, expect, it } from "vitest";
import exportCommand from "../export/index.js";
import inspectCommand from "./index.js";

/**
 * 複数 URL 対応は「citty が宣言済み positional を `parsed._` の**コピー**から shift する」
 * という未文書の内部挙動に依存している。citty を上げた際にここが変わると、
 * `inspect URL1 URL2` が黙って URL2 だけを見る（誤ったデータを exit 0 で返す）という
 * 最悪の壊れ方をし、型検査もユニットテストも緑のまま通ってしまう。
 * 依存している前提そのものを、実際に入っている citty に対して固定する
 */
describe.each([
  ["inspect", inspectCommand],
  ["export", exportCommand],
])("%s の positional 引数", (_name, command) => {
  const argsDef = command.args ?? {};

  it("args._ に宣言済み positional を含むすべての URL が残る", () => {
    const args = parseArgs(["https://a", "https://b"], argsDef);

    expect(args._).toEqual(["https://a", "https://b"]);
  });

  // ここが崩れると [args.url, ...args._] という書き方が正しくなり、
  // 現在の args._ 単独渡しが先頭 URL を取りこぼす側へ反転する
  it("args._[0] は宣言済み positional と同じ値である", () => {
    const args = parseArgs(["https://a", "https://b"], argsDef);

    expect(args.url).toBe("https://a");
    expect(args._[0]).toBe(args.url);
  });

  it("宣言済みフラグの値は args._ に漏れない", () => {
    const args = parseArgs(["https://a", "--profile", "work"], argsDef);

    expect(args._).toEqual(["https://a"]);
  });
});

/**
 * inspect の --output のパースを、実際に入っている citty に対して固定する。
 * 値が positional に漏れると、出力先ディレクトリが URL として解釈されて Invalid Figma URL になる
 */
describe("inspect の --output", () => {
  it("--output の値は args.output に入り、args._ に漏れない", () => {
    const args = parseArgs(
      ["https://a", "--output", "./out"],
      // args は Resolvable 型（Promise も許す）なので、静的に定義済みであることを型に伝える
      inspectCommand.args as ArgsDef,
    );

    expect(args.output).toBe("./out");
    expect(args._).toEqual(["https://a"]);
  });
});
