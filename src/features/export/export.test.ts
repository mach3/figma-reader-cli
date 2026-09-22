import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFigmaUrls } from "../../lib/figma-url.js";
import {
  alignImagesToRequest,
  collectNodeIds,
  downloadImages,
  getImages,
  parseImageFormat,
  parseScale,
} from "./export.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

describe("parseImageFormat", () => {
  it.each(["png", "svg", "pdf"])("%o をそのまま返す", (format) => {
    expect(parseImageFormat(format)._unsafeUnwrap()).toBe(format);
  });

  it.each(["gif", "PNG", ""])("%o はエラーを返す", (format) => {
    expect(parseImageFormat(format)._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--format must be one of: png, svg, pdf",
    });
  });
});

describe("parseScale", () => {
  it.each([
    ["1", 1],
    ["0.01", 0.01],
    ["4", 4],
    ["2.5", 2.5],
    // parseFloat の既存挙動をそのまま維持する
    ["2abc", 2],
  ])("%o は %o にパースする", (input, expected) => {
    expect(parseScale(input)._unsafeUnwrap()).toBe(expected);
  });

  it.each(["0", "0.001", "4.1", "5", "abc", ""])("%o はエラーを返す", (input) => {
    expect(parseScale(input)._unsafeUnwrapErr()).toEqual({
      type: "CUSTOM_ERROR",
      message: "--scale must be between 0.01 and 4",
    });
  });
});

describe("collectNodeIds", () => {
  it("URL の nodeId だけを返す", () => {
    expect(collectNodeIds(["1:2"], undefined)._unsafeUnwrap()).toEqual(["1:2"]);
  });

  it("複数 URL の nodeId を入力順のまま返す", () => {
    expect(collectNodeIds(["1:2", "10:99"], undefined)._unsafeUnwrap()).toEqual(["1:2", "10:99"]);
  });

  it("--ids を URL の nodeId の後ろに連結する", () => {
    expect(collectNodeIds(["1:2"], "4:56,7:89")._unsafeUnwrap()).toEqual(["1:2", "4:56", "7:89"]);
  });

  it("複数 URL の nodeId と --ids を連結する", () => {
    expect(collectNodeIds(["1:2", "10:99"], "4:56")._unsafeUnwrap()).toEqual([
      "1:2",
      "10:99",
      "4:56",
    ]);
  });

  it("--ids の各要素をトリムする", () => {
    expect(collectNodeIds(["1:2"], " 4:56 , 7:89 ")._unsafeUnwrap()).toEqual([
      "1:2",
      "4:56",
      "7:89",
    ]);
  });

  // 空要素は「取得できなかった値が join された」可能性があるため、黙って捨てずにエラーにする
  it.each(["4:56,", ",4:56", "4:56,,7:89", ",,", " "])(
    "--ids が %o なら空要素としてエラーを返す",
    (ids) => {
      expect(collectNodeIds(["1:2"], ids)._unsafeUnwrapErr()).toEqual({
        type: "CUSTOM_ERROR",
        message: "--ids contains an empty node ID",
      });
    },
  );
});

describe("getImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("正しい API パスとパラメータでリクエストする", async () => {
    const mockResponse = { err: null, images: { "1:23": "https://example.com/image.png" } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getImages({
      fileKey: "ABC123",
      nodeIds: ["1:23"],
      token: "test-token",
      format: "png",
      scale: 1,
    });

    expect(result.isOk()).toBe(true);
    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("/v1/images/ABC123");
    expect(calledUrl).toContain("ids=1%3A23");
    expect(calledUrl).toContain("format=png");
    expect(calledUrl).toContain("scale=1");
  });

  it("複数ノード ID をカンマ区切りで送信する", async () => {
    const mockResponse = { err: null, images: {} };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await getImages({
      fileKey: "ABC123",
      nodeIds: ["1:23", "4:56"],
      token: "test-token",
      format: "svg",
      scale: 2,
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("ids=1%3A23%2C4%3A56");
    expect(calledUrl).toContain("format=svg");
    // SVG の場合は scale を送らない
    expect(calledUrl).not.toContain("scale=");
  });

  it("png の場合は scale パラメータを送信する", async () => {
    const mockResponse = { err: null, images: {} };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    await getImages({
      fileKey: "ABC123",
      nodeIds: ["1:23"],
      token: "test-token",
      format: "png",
      scale: 2,
    });

    const calledUrl = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(calledUrl).toContain("scale=2");
  });

  it("API エラー時に err を返す", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));

    const result = await getImages({
      fileKey: "INVALID",
      nodeIds: ["1:23"],
      token: "test-token",
      format: "png",
      scale: 1,
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().type).toBe("API_ERROR");
  });

  it("レスポンスの err フィールドがある場合に API_ERROR を返す", async () => {
    const mockResponse = { err: "Invalid node", images: {} };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 }),
    );

    const result = await getImages({
      fileKey: "ABC123",
      nodeIds: ["999:999"],
      token: "test-token",
      format: "png",
      scale: 1,
    });

    expect(result.isErr()).toBe(true);
    const error = result._unsafeUnwrapErr();
    expect(error.type).toBe("API_ERROR");
    if (error.type === "API_ERROR") {
      expect(error.message).toBe("Invalid node");
    }
  });
});

describe("downloadImages", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("画像をダウンロードしてファイルに保存する", async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(imageData, { status: 200 }));
    const result = await downloadImages(
      { "1:23": "https://example.com/image.png" },
      "png",
      "./out",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.successes).toHaveLength(1);
      expect(result.value.successes[0].nodeId).toBe("1:23");
      expect(result.value.successes[0].filePath).toContain("1-23.png");
      expect(result.value.failures).toHaveLength(0);
    }
    const fs = await import("node:fs/promises");
    expect(fs.writeFile).toHaveBeenCalled();
  });

  it("URL が null の場合はスキップして failures に記録する", async () => {
    const result = await downloadImages({ "1:23": null }, "png", "./out");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.successes).toHaveLength(0);
      expect(result.value.failures).toHaveLength(1);
      expect(result.value.failures[0].nodeId).toBe("1:23");
    }
  });

  it("HTTP エラー時はスキップして failures に記録する", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Error", { status: 403 }));
    const result = await downloadImages(
      { "1:23": "https://example.com/image.png" },
      "png",
      "./out",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.successes).toHaveLength(0);
      expect(result.value.failures).toHaveLength(1);
      expect(result.value.failures[0].reason).toBe("HTTP 403");
    }
  });

  it("複数ノードで一部失敗しても他は成功する", async () => {
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(imageData, { status: 200 })),
    );

    const result = await downloadImages(
      { "1:23": "https://example.com/a.png", "4:56": null, "7:89": "https://example.com/b.png" },
      "png",
      "./out",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.successes).toHaveLength(2);
      expect(result.value.failures).toHaveLength(1);
      expect(result.value.failures[0].nodeId).toBe("4:56");
    }
  });

  it("fetch 例外時はスキップして failures に記録する", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const result = await downloadImages(
      { "1:23": "https://example.com/image.png" },
      "png",
      "./out",
    );

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.successes).toHaveLength(0);
      expect(result.value.failures).toHaveLength(1);
      expect(result.value.failures[0].reason).toBe("Error occurred during download");
    }
  });
});

describe("alignImagesToRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Figma がキーごと落としたノードは downloadImages の走査対象から外れ、
  // 成功にも失敗にも数えられないまま exit 0 になる。null へ正規化して既存の失敗経路に載せる
  it("レスポンスに無い node-id を null で補う", () => {
    const aligned = alignImagesToRequest({ "1:2": "https://img/1-2.svg" }, ["1:2", "10:99"]);

    expect(aligned).toEqual({ "1:2": "https://img/1-2.svg", "10:99": null });
  });

  it("既にある値を上書きしない", () => {
    const aligned = alignImagesToRequest({ "1:2": "https://img/1-2.svg", "10:99": null }, [
      "1:2",
      "10:99",
    ]);

    expect(aligned).toEqual({ "1:2": "https://img/1-2.svg", "10:99": null });
  });

  // 要求していない id が返ってきても捨てない。取得できたデータを黙って失うほうが害が大きい
  it("要求していない id がレスポンスにあっても残す", () => {
    const aligned = alignImagesToRequest({ "1:2": "https://img/1-2.svg", "9:9": "https://img/9" }, [
      "1:2",
    ]);

    expect(aligned["9:9"]).toBe("https://img/9");
  });

  it("欠落がなければレスポンスと同じ内容を返す", () => {
    const images = { "1:2": "https://img/1-2.svg" };

    expect(alignImagesToRequest(images, ["1:2"])).toEqual(images);
  });

  // 補完した null が downloadImages の failures に載り、exit 1 の判定材料になることまで通す
  it("補完した null が failures として報告される", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0x3c, 0x73, 0x76, 0x67]), { status: 200 }),
    );
    const aligned = alignImagesToRequest({ "1:2": "https://img/1-2.svg" }, ["1:2", "10:99"]);

    const summary = (await downloadImages(aligned, "svg", "/tmp/out"))._unsafeUnwrap();

    expect(summary.failures).toEqual([{ nodeId: "10:99", reason: "Failed to get image URL" }]);
    expect(summary.successes.map((s) => s.nodeId)).toEqual(["1:2"]);
  });
});

describe("カンマ区切り node-id の URL（回帰）", () => {
  // parseFigmaUrls が合成文字列 "1:2,10:99" を 1 要素で返していた頃、
  // alignImagesToRequest がそれをレスポンスのキーと照合できず幻の null を足し、
  // 両ノードとも取得できているのに failures 1 件・exit 1 になっていた
  it("両ノードが返っていれば欠落を捏造しない", () => {
    const requested = collectNodeIds(
      parseFigmaUrls(["https://www.figma.com/design/ABC/F?node-id=1-2,10-99"])._unsafeUnwrap()
        .nodeIds,
      undefined,
    )._unsafeUnwrap();
    const response = { "1:2": "https://img/a", "10:99": "https://img/b" };

    expect(requested).toEqual(["1:2", "10:99"]);
    expect(alignImagesToRequest(response, requested)).toEqual(response);
  });
});
