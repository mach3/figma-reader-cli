import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadImages, getImages } from "./export.js";

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

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
      expect(result.value.failures[0].reason).toBe("ダウンロード中にエラーが発生しました");
    }
  });
});
