import { defineCommand } from "citty";
import {
  type CacheMeta,
  formatAge,
  formatCacheWriteHint,
  normalizeRequest,
  resolveCacheSettings,
  STALE_WARNING_SECONDS,
} from "../../lib/cache.js";
import { resolveToken } from "../../lib/config.js";
import { outputError } from "../../lib/error.js";
import type { FigmaNode, FigmaNodesResponse } from "../../lib/figma-client.js";
import { parseFigmaUrls } from "../../lib/figma-url.js";
import { filterStylesResponse } from "./filter-styles.js";
import {
  buildOutputWriteHint,
  checkOutputOption,
  checkStylesConflict,
  getNodesWithCache,
  hasCachedNodes,
  parseDepth,
  prepareOutputFile,
  writeOutputFile,
} from "./inspect.js";

export default defineCommand({
  meta: {
    name: "inspect",
    description: "Get design context from a Figma node URL",
  },
  args: {
    url: {
      type: "positional",
      required: true,
      // citty は可変長 positional を表現できず --help は <URL> を 1 個しか出さないため、
      // 複数渡せることを伝えられるのはこの説明文だけ
      description:
        'Figma node URL(s), each wrapped in quotes e.g. "https://..." "https://...". Several URLs of the same file are fetched in one request',
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
    refresh: {
      type: "boolean",
      default: false,
      description: "Bypass the local cache and fetch from the Figma API",
    },
    output: {
      type: "string",
      description:
        "Write the JSON output to a file in this directory instead of stdout (created if missing). The CLI chooses the file name; stdout then gets a short JSON with its path, _cache and _request. Cannot be combined with --pretty",
    },
    profile: {
      type: "string",
      description:
        "Profile name to use for this run (overrides FIGMA_TOKEN and the active profile)",
    },
  },
  async run({ args }) {
    // --styles を指定する主体はエージェントなので、このエラーは常に JSON で返す
    const conflictResult = checkStylesConflict({
      styles: args.styles,
      pretty: args.pretty,
      geometry: args.geometry,
    });
    if (conflictResult.isErr()) {
      outputError(false, conflictResult.error);
      return process.exit(1);
    }

    // --output も --pretty と併用できないため、エラーは常に JSON で返す
    const outputOptionResult = checkOutputOption({ output: args.output, pretty: args.pretty });
    if (outputOptionResult.isErr()) {
      outputError(false, outputOptionResult.error);
      return process.exit(1);
    }

    // args._ が URL 列そのもの。args.url と混ぜてはならない（理由は parseFigmaUrls の JSDoc）
    const urlResult = parseFigmaUrls(args._);
    if (urlResult.isErr()) {
      outputError(args.pretty, urlResult.error);
      return process.exit(1);
    }

    // キャッシュを参照するのは inspect だけなので、env はここで初めて読む（auth や me を落とさない）。
    // トークン解決より前に置くのは、トークン未設定と env の誤りが重なったときに往復を増やさないため
    const cacheResult = resolveCacheSettings();
    if (cacheResult.isErr()) {
      outputError(args.pretty, cacheResult.error);
      return process.exit(1);
    }

    const tokenResult = await resolveToken(args.profile);
    if (tokenResult.isErr()) {
      outputError(args.pretty, tokenResult.error);
      return process.exit(1);
    }

    const { fileKey, nodeIds } = urlResult.value;
    const nodeId = nodeIds.join(",");

    const depthResult = parseDepth(args.depth);
    if (depthResult.isErr()) {
      outputError(args.pretty, depthResult.error);
      return process.exit(1);
    }

    const nodesOptions = {
      fileKey,
      nodeId,
      token: tokenResult.value,
      depth: depthResult.value,
      geometry: args.geometry,
      cache: cacheResult.value,
    };

    // 出力先の準備は、他の検証をすべて通った後・API の直前に行う。検証エラーで終わる実行に
    // ディレクトリを残さず、書けない出力先ではレートリミットを消費する前に止めるため
    let outputPath: string | undefined;
    if (args.output !== undefined) {
      const prepareResult = await prepareOutputFile({
        // checkOutputOption は trim 後の値で検査している。生の値を渡すと ` out` のような
        // 前後に空白を含む名前のディレクトリができてしまう
        dir: args.output.trim(),
        request: normalizeRequest(nodesOptions),
        styles: args.styles,
        cwd: process.cwd(),
      });
      if (prepareResult.isErr()) {
        outputError(false, prepareResult.error);
        return process.exit(1);
      }
      outputPath = prepareResult.value;
    }

    const nodesResult = await getNodesWithCache({ ...nodesOptions, refresh: args.refresh });

    if (nodesResult.isErr()) {
      // --refresh は API を必ず呼ぶため、429 などで失敗すると使えるキャッシュが
      // あっても何も返らない。手元にキャッシュがあることだけは伝える
      const hint =
        args.refresh && (await hasCachedNodes(nodesOptions))
          ? "A cached response for this request is available. Re-run without --refresh to use it."
          : undefined;
      outputError(args.pretty, nodesResult.error, hint);
      return process.exit(1);
    }

    const { response, meta, request, writeFailure, staleEntryRemains } = nodesResult.value;
    // 原因と回復手段を添えないと、sandbox に書き込みを拒否され続けていても気づけない
    // 書き込み失敗がないときは既存の文面を変えないよう、句点も hint 側に含める
    const writeHint = writeFailure ? `. ${formatCacheWriteHint(writeFailure)}` : "";

    // 警告は stdout の JSON を汚さないよう stderr に出す
    if (writeFailure && !staleEntryRemains) {
      console.error(
        `Warning: failed to write the cache; the next run will call the Figma API again${writeHint}`,
      );
    }
    // 取り直したデータを保存できず、かつ古いエントリも消せなかった場合だけは
    // 「次回は API を呼ぶ」が成り立たない。古い結果が返りうることを伝える
    if (staleEntryRemains) {
      console.error(
        `Warning: could not store this response and could not remove the older cached one; running without --refresh may return the stale response${writeHint}`,
      );
    }
    // 文面は _cache.note を使い回す。同じ案内を二重に管理しない
    if (meta.hit && meta.ageSeconds > STALE_WARNING_SECONDS) {
      console.error(`Warning: ${meta.note}`);
    }

    if (args.pretty) {
      formatNodesResponse(response, meta, request.nodeIds);
      return;
    }

    // 要求した node-id をエコーする。Figma は解決できない id を null で返すことも
    // キーごと落とすこともあり、後者だと nodes を見るだけでは欠落に気づけない。
    // 複数ノードをまとめて取るほど部分欠落が黙って通る確率が上がる。
    // 値は normalizeRequest 済み（重複除去・辞書順ソート）なので引数の順とは対応しない。
    // nodes のキーとの集合比較に使うものであって、URL との位置対応には使えない
    const requestEcho = { nodeIds: request.nodeIds };
    // stdout とファイルで同じ文字列を使い、--output の有無で中身がずれないようにする
    const body = JSON.stringify({
      _cache: meta,
      _request: requestEcho,
      ...(args.styles ? filterStylesResponse(response) : response),
    });

    if (outputPath === undefined) {
      console.log(body);
      return;
    }

    // console.log と同じく末尾に改行を付け、`> file` で保存した場合とバイト単位で揃える
    const writeResult = await writeOutputFile(outputPath, `${body}\n`);
    if (writeResult.isErr()) {
      outputError(
        false,
        writeResult.error,
        buildOutputWriteHint({ cached: meta.cached, refresh: args.refresh, staleEntryRemains }),
      );
      return process.exit(1);
    }
    // _cache と _request も載せる。古いキャッシュの hit や書き込み失敗の note、
    // 部分欠落の手がかりは、エージェントがファイルを開かなくても目に入る必要がある
    console.log(
      JSON.stringify({ success: true, path: outputPath, _cache: meta, _request: requestEcho }),
    );
  },
});

function formatNodesResponse(
  response: FigmaNodesResponse,
  meta: CacheMeta,
  requestedNodeIds: string[],
): void {
  console.log(formatCacheLine(meta));
  console.log(`File: ${response.name}`);
  console.log(`Last Modified: ${response.lastModified}`);
  console.log(`Editor: ${response.editorType}`);
  console.log("");

  // レスポンスではなく要求した id を起点に回す。Figma は解決できない id を
  // null で返すこともキーごと落とすこともあり、後者だと出力から消えて
  // 「取得できた」ように見えてしまう
  for (const id of requestedNodeIds) {
    const nodeInfo = response.nodes[id];
    if (nodeInfo === null || nodeInfo === undefined) {
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

/** pretty 出力の 1 行目。JSON の _cache と同じ事実を人間向けに縮めたもの */
function formatCacheLine(meta: CacheMeta): string {
  // 無効時も hit:false, cached:false なので、先に判定しないと「保存に失敗した」と読める
  if (!meta.enabled) {
    return "Cache: disabled (FIGMA_READER_CACHE)";
  }
  if (meta.hit) {
    return `Cache: hit (fetched ${formatAge(meta.ageSeconds)} ago)`;
  }
  // 保存できていない場合に黙っていると「次回はキャッシュから返る」と誤解される
  return meta.cached ? "Cache: miss (stored)" : "Cache: miss (NOT stored)";
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
