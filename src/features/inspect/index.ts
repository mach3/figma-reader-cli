import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { outputError } from "../../lib/error.js";
import type { FigmaNode, FigmaNodesResponse } from "../../lib/figma-client.js";
import { parseFigmaUrl } from "../../lib/figma-url.js";
import { filterStylesResponse } from "./filter-styles.js";
import { getNodes } from "./inspect.js";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Get design context from a Figma node URL",
  },
  args: {
    url: {
      type: "positional",
      required: true,
      description: 'Figma node URL (wrap in quotes e.g. "https://...")',
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
    depth: {
      type: "string", // citty に number 型がないため string で受けて parseInt する
      description: "Limit node tree depth (positive integer)",
    },
    geometry: {
      type: "boolean",
      default: false,
      description: "Include vector data (path information)",
    },
    styles: {
      type: "boolean",
      default: false,
      description:
        "Output style-focused JSON (removes noise fields, keeps fills/strokes/effects etc.)",
    },
    profile: {
      type: "string",
      description:
        "Profile name to use for this run (overrides FIGMA_TOKEN and the active profile)",
    },
  },
  async run({ args }) {
    // --styles は機械可読出力専用。--pretty との暗黙の優先順位を作らず明示的にエラーにする。
    // --geometry はフィルタが fillGeometry/strokeGeometry を除去するため、重い API レスポンスを
    // 取得した末に黙って捨てることになる。どちらも黙殺せずエラーで返す。
    // --styles を指定する主体はエージェントなので、このエラーは常に JSON で返す
    const conflicted = args.pretty ? "--pretty" : args.geometry ? "--geometry" : undefined;
    if (args.styles && conflicted) {
      outputError(false, {
        type: "CUSTOM_ERROR",
        message: `--styles cannot be combined with ${conflicted}`,
      });
      return process.exit(1);
    }

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

    const { fileKey, nodeId } = urlResult.value;
    const depth = args.depth !== undefined ? Number.parseInt(args.depth, 10) : undefined;

    if (depth !== undefined && (Number.isNaN(depth) || depth < 1)) {
      outputError(args.pretty, {
        type: "CUSTOM_ERROR",
        message: "--depth must be a positive integer",
      });
      return process.exit(1);
    }

    const nodesResult = await getNodes({
      fileKey,
      nodeId,
      token: tokenResult.value,
      depth,
      geometry: args.geometry,
    });

    if (nodesResult.isErr()) {
      outputError(args.pretty, nodesResult.error);
      return process.exit(1);
    }

    const response = nodesResult.value;

    if (args.pretty) {
      formatNodesResponse(response);
    } else {
      console.log(JSON.stringify(args.styles ? filterStylesResponse(response) : response));
    }
  },
});

function formatNodesResponse(response: FigmaNodesResponse): void {
  console.log(`File: ${response.name}`);
  console.log(`Last Modified: ${response.lastModified}`);
  console.log(`Editor: ${response.editorType}`);
  console.log("");

  for (const [id, nodeInfo] of Object.entries(response.nodes)) {
    if (nodeInfo === null) {
      console.log(`Node ${id}: not found`);
      continue;
    }
    formatNode(nodeInfo.document, 0);

    const componentCount = Object.keys(nodeInfo.components).length;
    const styleCount = Object.keys(nodeInfo.styles).length;
    if (componentCount > 0 || styleCount > 0) {
      console.log("");
      if (componentCount > 0) {
        console.log(`Components: ${componentCount}`);
      }
      if (styleCount > 0) {
        console.log(`Styles: ${styleCount}`);
      }
    }
  }
}

function formatNode(node: FigmaNode, depth: number): void {
  const indent = "  ".repeat(depth);
  const bbox = node.absoluteBoundingBox;
  const size = bbox ? ` (${bbox.width}x${bbox.height})` : "";
  const text = node.characters ? ` "${truncate(node.characters, 40)}"` : "";

  console.log(`${indent}[${node.type}] ${node.name}${size}${text}`);

  if (node.children) {
    for (const child of node.children) {
      formatNode(child, depth + 1);
    }
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength)}...`;
}
