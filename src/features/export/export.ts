import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "../../lib/error.js";
import { type FigmaImagesResponse, figmaGet } from "../../lib/figma-client.js";

export type ImageFormat = "png" | "svg" | "pdf";

export type ExportImagesOptions = {
  fileKey: string;
  nodeIds: string[];
  token: string;
  format: ImageFormat;
  scale: number;
};

export type DownloadResult = {
  nodeId: string;
  filePath: string;
};

export type DownloadSummary = {
  successes: DownloadResult[];
  failures: { nodeId: string; reason: string }[];
};

/** Figma Images API からノードの画像 URL を取得する */
export async function getImages(
  options: ExportImagesOptions,
): Promise<Result<FigmaImagesResponse, AppError>> {
  const params = new URLSearchParams({
    ids: options.nodeIds.join(","),
    format: options.format,
  });

  // scale は png/pdf のみ有効（SVG では無視される）
  if (options.format !== "svg") {
    params.set("scale", String(options.scale));
  }

  const result = await figmaGet<FigmaImagesResponse>(
    options.token,
    `/v1/images/${options.fileKey}?${params}`,
  );

  if (result.isErr()) {
    return result;
  }

  if (result.value.err) {
    return err({ type: "API_ERROR", status: 200, message: result.value.err });
  }

  return result;
}

/** 画像 URL からファイルをダウンロードして保存する。失敗したノードはスキップして続行する */
export async function downloadImages(
  images: Record<string, string | null>,
  format: ImageFormat,
  outputDir: string,
): Promise<Result<DownloadSummary, AppError>> {
  await fs.mkdir(outputDir, { recursive: true });

  const entries = Object.entries(images);
  const results = await Promise.allSettled(
    entries.map(([nodeId, url]) => downloadSingleImage(nodeId, url, format, outputDir)),
  );

  const successes: DownloadResult[] = [];
  const failures: DownloadSummary["failures"] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      if (result.value.ok) {
        successes.push(result.value.value);
      } else {
        failures.push(result.value.error);
      }
    }
  }

  return ok({ successes, failures });
}

async function downloadSingleImage(
  nodeId: string,
  url: string | null,
  format: ImageFormat,
  outputDir: string,
): Promise<
  { ok: true; value: DownloadResult } | { ok: false; error: { nodeId: string; reason: string } }
> {
  if (url === null) {
    return { ok: false, error: { nodeId, reason: "画像 URL が取得できませんでした" } };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: { nodeId, reason: `HTTP ${response.status}` } };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const fileName = `${nodeId.replace(/:/g, "-")}.${format}`;
    const filePath = path.join(outputDir, fileName);

    await fs.writeFile(filePath, buffer);
    return { ok: true, value: { nodeId, filePath } };
  } catch {
    return { ok: false, error: { nodeId, reason: "ダウンロード中にエラーが発生しました" } };
  }
}
