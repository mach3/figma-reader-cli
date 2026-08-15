import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { outputError } from "../../lib/error.js";
import { parseFigmaUrl } from "../../lib/figma-url.js";
import {
  collectNodeIds,
  type DownloadSummary,
  downloadImages,
  getImages,
  parseImageFormat,
  parseScale,
} from "./export.js";

export default defineCommand({
  meta: {
    name: "export",
    description: "Export Figma nodes as PNG/SVG/PDF images",
  },
  args: {
    url: {
      type: "positional",
      required: true,
      description: 'Figma node URL (wrap in quotes e.g. "https://...")',
    },
    ids: {
      type: "string",
      description: "Additional node IDs (comma-separated e.g. 4:56,7:89)",
    },
    format: {
      type: "string",
      default: "png",
      description: "Output format: png, svg, pdf",
    },
    scale: {
      type: "string",
      default: "1",
      description: "Scale factor (0.01-4, png/pdf only)",
    },
    download: {
      type: "boolean",
      default: false,
      description: "Download images as files",
    },
    output: {
      type: "string",
      default: ".",
      description: "Download destination directory",
    },
    profile: {
      type: "string",
      description:
        "Profile name to use for this run (overrides FIGMA_TOKEN and the active profile)",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const urlResult = parseFigmaUrl(args.url);
    if (urlResult.isErr()) {
      outputError(args.pretty, urlResult.error);
      return process.exit(1);
    }

    const tokenResult = await resolveToken(args.profile);
    if (tokenResult.isErr()) {
      outputError(args.pretty, tokenResult.error);
      return process.exit(1);
    }

    const formatResult = parseImageFormat(args.format);
    if (formatResult.isErr()) {
      outputError(args.pretty, formatResult.error);
      return process.exit(1);
    }
    const format = formatResult.value;

    const scaleResult = parseScale(args.scale);
    if (scaleResult.isErr()) {
      outputError(args.pretty, scaleResult.error);
      return process.exit(1);
    }

    const { fileKey, nodeId } = urlResult.value;

    const nodeIdsResult = collectNodeIds(nodeId, args.ids);
    if (nodeIdsResult.isErr()) {
      outputError(args.pretty, nodeIdsResult.error);
      return process.exit(1);
    }

    const imagesResult = await getImages({
      fileKey,
      nodeIds: nodeIdsResult.value,
      token: tokenResult.value,
      format,
      scale: scaleResult.value,
    });

    if (imagesResult.isErr()) {
      outputError(args.pretty, imagesResult.error);
      return process.exit(1);
    }

    const { images } = imagesResult.value;

    // ダウンロードモード
    if (args.download) {
      const downloadResult = await downloadImages(images, format, args.output);
      if (downloadResult.isErr()) {
        outputError(args.pretty, downloadResult.error);
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
