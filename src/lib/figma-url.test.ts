import { describe, expect, it } from "vitest";
import { parseFigmaUrl } from "./figma-url.js";

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
