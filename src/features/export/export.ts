import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "../../lib/error.js";
import { type FigmaImagesResponse, figmaGet } from "../../lib/figma-client.js";

const VALID_FORMATS = ["png", "svg", "pdf"] as const;

export type ImageFormat = (typeof VALID_FORMATS)[number];

/** --format を検証して ImageFormat に絞り込む */
export function parseImageFormat(format: string): Result<ImageFormat, AppError> {
  const found = VALID_FORMATS.find((valid) => valid === format);
  if (found === undefined) {
    return err({
      type: "CUSTOM_ERROR",
      message: `--format must be one of: ${VALID_FORMATS.join(", ")}`,
    });
  }
  return ok(found);
}

/** --scale をパースする。Figma API が受け付ける 0.01〜4 の範囲に限る */
export function parseScale(scale: string): Result<number, AppError> {
  const parsed = Number.parseFloat(scale);
  if (Number.isNaN(parsed) || parsed < 0.01 || parsed > 4) {
    return err({ type: "CUSTOM_ERROR", message: "--scale must be between 0.01 and 4" });
  }
  return ok(parsed);
}

/**
 * URL の node-id と --ids からエクスポート対象のノード ID を集める。
 *
 * --ids の空要素は黙って捨てずにエラーにする。主な呼び出し元は AI エージェントであり、
 * 空要素は末尾カンマより「配列の要素が undefined のまま join された」＝取得したかった
 * ノードが欠けているシグナルである可能性が高い。捨てると要求より少ないノードを
 * エクスポートしたうえで success を返すことになり、呼び出し元が欠落に気づけない。
 * 空要素のまま API に送ると 1 回分のレートリミットを無駄にするため、送る前に落とす
 */
export function collectNodeIds(
  nodeId: string,
  ids: string | undefined,
): Result<string[], AppError> {
  const extra = ids ? ids.split(",").map((id) => id.trim()) : [];

  if (extra.some((id) => id === "")) {
    return err({ type: "CUSTOM_ERROR", message: "--ids contains an empty node ID" });
  }
  return ok([nodeId, ...extra]);
}

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
    return { ok: false, error: { nodeId, reason: "Failed to get image URL" } };
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
    return { ok: false, error: { nodeId, reason: "Error occurred during download" } };
  }
}
