import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { formatError, outputError } from "../../lib/error.js";
import { parseFigmaUrl } from "../../lib/figma-url.js";
import { type DownloadSummary, downloadImages, getImages, type ImageFormat } from "./export.js";

const VALID_FORMATS: readonly ImageFormat[] = ["png", "svg", "pdf"];

export default defineCommand({
  meta: {
    name: "export",
    description: "Figma ノードを PNG/SVG/PDF として画像エクスポートする",
  },
  args: {
    url: {
      type: "positional",
      required: true,
      description: 'Figma のノード URL（引用符で囲んでください 例: "https://..."）',
    },
    ids: {
      type: "string",
      description: "追加ノード ID（カンマ区切り 例: 4:56,7:89）",
    },
    format: {
      type: "string",
      default: "png",
      description: "出力形式: png, svg, pdf",
    },
    scale: {
      type: "string",
      default: "1",
      description: "スケール (0.01〜4, png/pdf のみ)",
    },
    download: {
      type: "boolean",
      default: false,
      description: "画像をファイルにダウンロードする",
    },
    output: {
      type: "string",
      default: ".",
      description: "ダウンロード先ディレクトリ",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "人間向けのテキスト形式で出力",
    },
  },
  async run({ args }) {
    const urlResult = parseFigmaUrl(args.url);
    if (urlResult.isErr()) {
      outputError(args.pretty, formatError(urlResult.error));
      return process.exit(1);
    }

    const tokenResult = await resolveToken();
    if (tokenResult.isErr()) {
      outputError(args.pretty, formatError(tokenResult.error));
      return process.exit(1);
    }

    // format バリデーション
    if (!VALID_FORMATS.includes(args.format as ImageFormat)) {
      outputError(
        args.pretty,
        `--format は ${VALID_FORMATS.join(", ")} のいずれかを指定してください`,
      );
      return process.exit(1);
    }
    const format = args.format as ImageFormat;

    // scale バリデーション
    const scale = Number.parseFloat(args.scale);
    if (Number.isNaN(scale) || scale < 0.01 || scale > 4) {
      outputError(args.pretty, "--scale は 0.01〜4 の範囲で指定してください");
      return process.exit(1);
    }

    // ノード ID の収集（URL の nodeId + --ids）
    const { fileKey, nodeId } = urlResult.value;
    const nodeIds: string[] = nodeId ? [nodeId] : [];
    if (args.ids) {
      nodeIds.push(...args.ids.split(",").map((id) => id.trim()));
    }
    if (nodeIds.length === 0) {
      outputError(args.pretty, "ノード ID が指定されていません");
      return process.exit(1);
    }

    const imagesResult = await getImages({
      fileKey,
      nodeIds,
      token: tokenResult.value,
      format,
      scale,
    });

    if (imagesResult.isErr()) {
      outputError(args.pretty, formatError(imagesResult.error));
      return process.exit(1);
    }

    const { images } = imagesResult.value;

    // ダウンロードモード
    if (args.download) {
      const downloadResult = await downloadImages(images, format, args.output);
      if (downloadResult.isErr()) {
        outputError(args.pretty, formatError(downloadResult.error));
        return process.exit(1);
      }

      const summary = downloadResult.value;
      if (args.pretty) {
        formatDownloadSummary(summary);
      } else {
        console.log(JSON.stringify(summary));
      }

      // 一部でも失敗があれば exit code 1
      if (summary.failures.length > 0) {
        return process.exit(1);
      }
      return;
    }

    // URL 出力モード
    if (args.pretty) {
      formatImagesResponse(images);
    } else {
      console.log(JSON.stringify({ images }));
    }
  },
});

function formatImagesResponse(images: Record<string, string | null>): void {
  for (const [nodeId, url] of Object.entries(images)) {
    if (url) {
      console.log(`Node ${nodeId}: ${url}`);
    } else {
      console.log(`Node ${nodeId}: (export failed)`);
    }
  }
}

function formatDownloadSummary(summary: DownloadSummary): void {
  for (const { nodeId, filePath } of summary.successes) {
    console.log(`Node ${nodeId} → ${filePath}`);
  }
  for (const { nodeId, reason } of summary.failures) {
    console.error(`Node ${nodeId}: failed (${reason})`);
  }
}
