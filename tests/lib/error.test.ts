import { describe, expect, it, vi } from "vitest";
import { type AppError, formatError, outputError } from "../../src/lib/error.js";

describe("formatError", () => {
  it("API_ERROR は retryAfter の有無に関わらず同じメッセージ", () => {
    const error: AppError = { type: "API_ERROR", status: 429, message: "Rate limited", retryAfter: 30 };
    expect(formatError(error)).toBe("Figma API error (429): Rate limited");
  });

  it("API_ERROR に retryAfter がない場合は通常のメッセージ", () => {
    const error: AppError = { type: "API_ERROR", status: 500, message: "Internal Error" };
    expect(formatError(error)).toBe("Figma API error (500): Internal Error");
  });

  it("403 の API_ERROR にはリトライ手順のヒントを添える", () => {
    const error: AppError = { type: "API_ERROR", status: 403, message: "Invalid token" };
    const message = formatError(error);
    expect(message).toContain("Figma API error (403): Invalid token");
    expect(message).toContain("auth list");
    expect(message).toContain("--profile");
  });

  it("404 の API_ERROR には node-id 確認と別プロファイルのヒントを添える", () => {
    const error: AppError = { type: "API_ERROR", status: 404, message: "Not found" };
    const message = formatError(error);
    expect(message).toContain("Figma API error (404): Not found");
    expect(message).toContain("node-id");
    expect(message).toContain("auth list");
    expect(message).toContain("--profile");
  });

  it("403/404 以外の API_ERROR にはヒントを含めない", () => {
    const error: AppError = { type: "API_ERROR", status: 400, message: "Bad request" };
    expect(formatError(error)).toBe("Figma API error (400): Bad request");
  });
});

describe("outputError", () => {
  it("JSON 出力に retryAfter を含める", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error: AppError = { type: "API_ERROR", status: 429, message: "Rate limited", retryAfter: 30 };

    outputError(false, error);

    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({
        success: false,
        error: "Figma API error (429): Rate limited",
        retryAfter: 30,
      }),
    );
    spy.mockRestore();
  });

  it("retryAfter がない API_ERROR では retryAfter フィールドを含めない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error: AppError = { type: "API_ERROR", status: 500, message: "Internal Error" };

    outputError(false, error);

    const output = JSON.parse(spy.mock.calls[0][0] as string);
    expect(output).toEqual({ success: false, error: "Figma API error (500): Internal Error" });
    expect(output).not.toHaveProperty("retryAfter");
    spy.mockRestore();
  });

  it("CUSTOM_ERROR のメッセージをそのまま出力できる", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(false, { type: "CUSTOM_ERROR", message: "カスタムエラー" });

    expect(spy).toHaveBeenCalledWith(
      JSON.stringify({ success: false, error: "カスタムエラー" }),
    );
    spy.mockRestore();
  });

  it("pretty モードでは人間向けテキストを出力する", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error: AppError = { type: "API_ERROR", status: 429, message: "Rate limited", retryAfter: 30 };

    outputError(true, error);

    expect(spy).toHaveBeenNthCalledWith(1, "Figma API error (429): Rate limited");
    expect(spy).toHaveBeenNthCalledWith(2, "Retry after 30 seconds");
    spy.mockRestore();
  });
});
