import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { type AppError, getErrnoCode } from "../../lib/error.js";
import { type FigmaImagesResponse, figmaGet } from "../../lib/figma-client.js";
import { checkOutputDir } from "../../lib/output-dir.js";

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
 * URL 群の node-id と --ids からエクスポート対象のノード ID を集める。
 *
 * --ids の空要素は黙って捨てずにエラーにする。主な呼び出し元は AI エージェントであり、
 * 空要素は末尾カンマより「配列の要素が undefined のまま join された」＝取得したかった
 * ノードが欠けているシグナルである可能性が高い。捨てると要求より少ないノードを
 * エクスポートしたうえで success を返すことになり、呼び出し元が欠落に気づけない。
 * 空要素のまま API に送ると 1 回分のレートリミットを無駄にするため、送る前に落とす
 */
export function collectNodeIds(
  nodeIds: string[],
  ids: string | undefined,
): Result<string[], AppError> {
  const extra = ids ? ids.split(",").map((id) => id.trim()) : [];

  if (extra.some((id) => id === "")) {
    return err({ type: "CUSTOM_ERROR", message: "--ids contains an empty node ID" });
  }
  return ok([...nodeIds, ...extra]);
}

/**
 * 要求したすべての node-id が images に現れることを保証する。
 *
 * Figma は返せなかったノードを `null` で返すこともキーごと落とすこともある。
 * 後者をそのまま流すと downloadImages の走査対象（レスポンスのキー）から外れ、
 * 成功にも失敗にも数えられないまま exit 0 になる ＝ 要求より少ないファイルを
 * 書いたうえで成功を返してしまう。欠落を `null` に正規化して既存の失敗経路へ合流させる
 */
export function alignImagesToRequest(
  images: Record<string, string | null>,
  nodeIds: string[],
): Record<string, string | null> {
  // レスポンス側を基点にするのは、要求していない id を Figma が返しても捨てないため
  const aligned = { ...images };
  for (const nodeId of nodeIds) {
    if (!(nodeId in aligned)) {
      aligned[nodeId] = null;
    }
  }
  return aligned;
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

/**
 * --download の保存先を作り、書き込めることを確かめる。API を呼ぶ前に使う。
 * 保存先が作れない・書けないことが API の後で分かると、レートリミットを消費したうえで
 * 1 枚も保存できない。mkdir は既存ディレクトリなら書けなくても成功するため、試し書きまで行う
 */
export async function prepareDownloadDir(
  // 型は string だが、citty は `--no-output` を false として渡してくる
  outputDir: string | boolean,
  cwd: string,
): Promise<Result<string, AppError>> {
  // 値の規則（空・`-` 始まり・`~`）は inspect と共通。以降は trim 済みの値だけを使う
  const dirResult = checkOutputDir(outputDir);
  if (dirResult.isErr()) {
    return err(dirResult.error);
  }

  const absDir = path.resolve(cwd, dirResult.value);
  try {
    await fs.mkdir(absDir, { recursive: true });
  } catch (error: unknown) {
    return err({
      type: "CUSTOM_ERROR",
      message: `Failed to create the --output directory ${absDir} (${getErrnoCode(error)}); no API request was made`,
    });
  }

  const probePath = path.join(absDir, `.figma-reader-write-test-${process.pid}.tmp`);
  try {
    // wx: 既存のファイルやシンボリックリンクを辿って切り詰めない
    await fs.writeFile(probePath, "", { flag: "wx" });
  } catch (error: unknown) {
    return err({
      type: "CUSTOM_ERROR",
      message: `Cannot write to the --output directory ${absDir} (${getErrnoCode(error)}); no API request was made`,
    });
  }
  await fs.unlink(probePath).catch(() => {});
  return ok(absDir);
}

/** 画像 URL からファイルをダウンロードして保存する。失敗したノードはスキップして続行する */
export async function downloadImages(
  images: Record<string, string | null>,
  format: ImageFormat,
  outputDir: string,
): Promise<Result<DownloadSummary, AppError>> {
  // 通常は prepareDownloadDir で作成済み。それでも失敗しうるので、例外で落とさず機械可読なエラーにする
  try {
    await fs.mkdir(outputDir, { recursive: true });
  } catch (error: unknown) {
    return err({
      type: "CUSTOM_ERROR",
      message: `Failed to create the --output directory ${outputDir} (${getErrnoCode(error)})`,
    });
  }

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

  let buffer: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { ok: false, error: { nodeId, reason: `HTTP ${response.status}` } };
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (error: unknown) {
    // 画像は api.figma.com とは別ホストから配信されるため、プロキシや sandbox の
    // 許可漏れはここにしか現れない。原因が分かる errno を残す。
    // 署名付きの url は JSON 出力とログに漏れるので含めない
    return {
      ok: false,
      error: { nodeId, reason: `Error occurred during download (${getErrnoCode(error)})` },
    };
  }

  const fileName = `${nodeId.replace(/:/g, "-")}.${format}`;
  const filePath = path.join(outputDir, fileName);
  // 書き込み失敗をダウンロード失敗と同じ文面にすると、ディスク不足を
  // 「画像ホストが許可されていない」と誤診させる（SKILL.md がその手順を指示している）
  try {
    await fs.writeFile(filePath, buffer);
  } catch (error: unknown) {
    return {
      ok: false,
      error: { nodeId, reason: `Failed to write ${filePath} (${getErrnoCode(error)})` },
    };
  }
  return { ok: true, value: { nodeId, filePath } };
}
