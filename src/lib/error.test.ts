import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppError, formatError, outputError } from "./error.js";

const multipleFileKeys: AppError = {
  type: "MULTIPLE_FILE_KEYS",
  groups: [
    { fileKey: "ABC123", urls: ["https://www.figma.com/design/ABC123/F?node-id=1-2"] },
    { fileKey: "XYZ789", urls: ["https://www.figma.com/design/XYZ789/G?node-id=3-4"] },
  ],
};

describe("formatError", () => {
  // 10 本渡されたときに error が数百文字になるのを避けるため、URL は文字列に載せない
  it("MULTIPLE_FILE_KEYS のメッセージに URL を列挙しない", () => {
    const message = formatError(multipleFileKeys);

    expect(message).not.toContain("figma.com");
    expect(message).toContain("2 different Figma files");
    expect(message).toContain("groups");
  });

  // レートリミットと取り違えて作業を止めないよう、予算未消費であることを必ず伝える
  it("MULTIPLE_FILE_KEYS のメッセージが API を呼んでいないことを伝える", () => {
    expect(formatError(multipleFileKeys)).toContain("No API call was made");
  });
});

describe("outputError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("MULTIPLE_FILE_KEYS の JSON に groups を含める", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(false, multipleFileKeys);

    expect(JSON.parse(spy.mock.calls[0][0] as string)).toEqual({
      success: false,
      error: formatError(multipleFileKeys),
      groups: multipleFileKeys.type === "MULTIPLE_FILE_KEYS" ? multipleFileKeys.groups : undefined,
    });
  });

  it("pretty では fileKey ごとに内訳を 1 行ずつ出す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(true, multipleFileKeys);

    const lines = spy.mock.calls.map((call) => call[0]);
    expect(lines).toEqual([
      formatError(multipleFileKeys),
      "  ABC123: https://www.figma.com/design/ABC123/F?node-id=1-2",
      "  XYZ789: https://www.figma.com/design/XYZ789/G?node-id=3-4",
    ]);
  });

  it("MULTIPLE_FILE_KEYS 以外の JSON に groups を足さない", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    outputError(false, { type: "INVALID_URL", message: "Malformed URL" });

    expect(JSON.parse(spy.mock.calls[0][0] as string)).not.toHaveProperty("groups");
  });
});
