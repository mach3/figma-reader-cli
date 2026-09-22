import { describe, expect, it } from "vitest";
import { buildCacheKey, normalizeRequest } from "./cache.js";
import { parseFigmaUrl, parseFigmaUrls } from "./figma-url.js";

describe("parseFigmaUrl", () => {
  it("標準的な design URL を解析できる", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyFile?node-id=1-23");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toEqual({
      fileKey: "ABC123",
      nodeId: "1:23",
    });
  });

  it("node-id のハイフンをコロンに変換する", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyFile?node-id=10-200");
    expect(result._unsafeUnwrap().nodeId).toBe("10:200");
  });

  it("node-id に複数のハイフンがある場合もすべてコロンに変換する", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyFile?node-id=1-2-3");
    expect(result._unsafeUnwrap().nodeId).toBe("1:2:3");
  });

  // カンマ区切りは 1 リクエストで複数ノードを取るための記法。パースを厳格化した際に
  // ここが静かに壊れると、まとめ取得の経路ごと失われる
  it("node-id のカンマ区切りをそのまま保つ", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyFile?node-id=1-2,10-99");
    expect(result._unsafeUnwrap().nodeId).toBe("1:2,10:99");
  });

  it("figma.com (www なし) も解析できる", () => {
    const result = parseFigmaUrl("https://figma.com/design/ABC123/MyFile?node-id=1-2");
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().fileKey).toBe("ABC123");
  });

  it("branch URL の場合は branchKey を fileKey として使う", () => {
    const result = parseFigmaUrl(
      "https://www.figma.com/design/ABC123/branch/BRANCH456/MyFile?node-id=1-2",
    );
    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap().fileKey).toBe("BRANCH456");
  });

  it("不正な URL でエラーを返す", () => {
    const result = parseFigmaUrl("not-a-url");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("INVALID_URL");
  });

  it("Figma 以外のホストでエラーを返す", () => {
    const result = parseFigmaUrl("https://example.com/design/ABC/File?node-id=1-2");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("INVALID_URL");
  });

  it("/design/ 以外のパスでエラーを返す", () => {
    const result = parseFigmaUrl("https://www.figma.com/board/ABC123/MyFile?node-id=1-2");
    expect(result.isErr()).toBe(true);
  });

  it("node-id パラメータがない場合エラーを返す", () => {
    const result = parseFigmaUrl("https://www.figma.com/design/ABC123/MyFile");
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toMatchObject({
      type: "INVALID_URL",
      message: expect.stringContaining("node-id"),
    });
  });
});

describe("parseFigmaUrls", () => {
  const file = (key: string, nodeId: string) =>
    `https://www.figma.com/design/${key}/MyFile?node-id=${nodeId}`;

  it("単一 URL を 1 要素の nodeIds にする", () => {
    const result = parseFigmaUrls([file("ABC123", "1-2")]);
    expect(result._unsafeUnwrap()).toEqual({ fileKey: "ABC123", nodeIds: ["1:2"] });
  });

  it("同一 fileKey の複数 URL を入力順の nodeIds に畳む", () => {
    const result = parseFigmaUrls([file("ABC123", "10-99"), file("ABC123", "1-2")]);
    expect(result._unsafeUnwrap()).toEqual({ fileKey: "ABC123", nodeIds: ["10:99", "1:2"] });
  });

  // 合成文字列のまま返すと、Figma が個別キーで返すレスポンスと照合できず、
  // export 側が成功した取得を「返ってこなかった」と誤判定する
  it("カンマ区切りの node-id を個別の要素へ展開する", () => {
    const result = parseFigmaUrls([file("ABC123", "1-2,10-99")]);
    expect(result._unsafeUnwrap().nodeIds).toEqual(["1:2", "10:99"]);
  });

  it("カンマ区切りの空要素と余分な空白を落とす", () => {
    const result = parseFigmaUrls([file("ABC123", "1-2, 10-99,")]);
    expect(result._unsafeUnwrap().nodeIds).toEqual(["1:2", "10:99"]);
  });

  it("node-id が区切り文字だけなら使える id がないとしてエラーを返す", () => {
    const error = parseFigmaUrls([file("ABC123", ",")])._unsafeUnwrapErr();
    expect(error.type).toBe("INVALID_URL");
  });

  it("重複する URL を除去しない", () => {
    const result = parseFigmaUrls([file("ABC123", "1-2"), file("ABC123", "1-2")]);
    expect(result._unsafeUnwrap().nodeIds).toEqual(["1:2", "1:2"]);
  });

  it("fileKey が混在する場合は初出順の groups を持つエラーを返す", () => {
    const a = file("ABC123", "1-2");
    const b = file("XYZ789", "3-4");
    const c = file("ABC123", "5-6");

    const error = parseFigmaUrls([a, b, c])._unsafeUnwrapErr();

    expect(error).toEqual({
      type: "MULTIPLE_FILE_KEYS",
      groups: [
        { fileKey: "ABC123", urls: [a, c] },
        { fileKey: "XYZ789", urls: [b] },
      ],
    });
  });

  // branch URL は branchKey を API の fileKey として使うため、同じファイルを指していても
  // 通常 URL とは別グループになる。既存仕様なのでここで固定しておく
  it("branch URL と通常 URL は同じファイルを指していても別グループになる", () => {
    const normal = file("ABC123", "1-2");
    const branch = "https://www.figma.com/design/ABC123/branch/BRANCH456/MyFile?node-id=3-4";

    const error = parseFigmaUrls([normal, branch])._unsafeUnwrapErr();

    expect(error).toMatchObject({
      type: "MULTIPLE_FILE_KEYS",
      groups: [
        { fileKey: "ABC123", urls: [normal] },
        { fileKey: "BRANCH456", urls: [branch] },
      ],
    });
  });

  // フラグ名を打ち間違えるとその値が positional に落ちる（`--dept 3` の `3` など）。
  // どの引数が問題かを添えないと、真の原因が出力のどこにも現れない
  it("URL として解釈できない引数はその値をメッセージに含むエラーを返す", () => {
    const error = parseFigmaUrls([file("ABC123", "1-2"), "3"])._unsafeUnwrapErr();

    expect(error.type).toBe("INVALID_URL");
    const message = "message" in error ? error.message : "";
    expect(message).toContain('(argument: "3")');
    expect(message).toContain("check the flag name");
  });

  it("URL が 1 つもない場合はエラーを返す", () => {
    expect(parseFigmaUrls([])._unsafeUnwrapErr().type).toBe("INVALID_URL");
  });

  // 単一 URL のキャッシュキーが従来と変わらないことを、実際のキー導出まで通して確かめる。
  // ここが変わると、既存ユーザーの手元にあるキャッシュが全件ミスになる
  it.each(["1-2", "1-2,10-99"])("単一 URL (node-id=%s) のキャッシュキーが従来と一致する", (id) => {
    const url = file("ABC123", id);
    const before = normalizeRequest({
      fileKey: "ABC123",
      nodeId: parseFigmaUrl(url)._unsafeUnwrap().nodeId,
    });

    const parsed = parseFigmaUrls([url])._unsafeUnwrap();
    const after = normalizeRequest({ fileKey: parsed.fileKey, nodeId: parsed.nodeIds.join(",") });

    expect(buildCacheKey(after)).toBe(buildCacheKey(before));
  });
});
