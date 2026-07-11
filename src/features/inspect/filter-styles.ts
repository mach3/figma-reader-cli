import type { FigmaNode, FigmaNodeInfo, FigmaNodesResponse } from "../../lib/figma-client.js";

/**
 * --styles 出力で各ノードに残すキー。
 * ホワイトリスト方式: Figma API が将来フィールドを追加してもノイズが混入しないよう、
 * 残すキーを明示列挙する（ブラックリストだと追加のたびに肥大化する）。
 */
const NODE_STYLE_KEYS = [
  "componentId",
  // 位置・サイズ
  "absoluteBoundingBox",
  // Auto Layout
  "layoutMode",
  "itemSpacing",
  "counterAxisSpacing",
  "counterAxisAlignContent",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "primaryAxisAlignItems",
  "counterAxisAlignItems",
  "layoutSizingHorizontal",
  "layoutSizingVertical",
  "layoutWrap",
  "layoutPositioning",
  // 塗り・線
  "fills",
  "strokes",
  "strokeWeight",
  "individualStrokeWeights",
  "strokeAlign",
  "strokeDashes",
  // 形状
  "cornerRadius",
  "rectangleCornerRadii",
  "rotation",
  "isMask",
  // 効果
  "effects",
  "opacity",
  // テキスト
  "characters",
  "style",
  "characterStyleOverrides",
  "styleOverrideTable",
  // 参照（スタイル ID / Variables）
  "styles",
  "boundVariables",
] as const;

function filterNode(node: FigmaNode): FigmaNode {
  const filtered: FigmaNode = { id: node.id, name: node.name, type: node.type };
  // NODE_STYLE_KEYS のリテラル型と FigmaNode の宣言済みプロパティ型が交差して
  // 代入エラーになるため、書き込みは index signature 経由で行う
  const sink = filtered as Record<string, unknown>;

  // visible はデフォルト true のため、false のときだけ残す
  if (node.visible === false) {
    sink.visible = false;
  }

  for (const key of NODE_STYLE_KEYS) {
    const value = node[key];
    // undefined と空配列は情報を持たないため落とす（出力サイズ削減）
    if (value === undefined || (Array.isArray(value) && value.length === 0)) continue;
    sink[key] = value;
  }

  // 空の children はスタイルキーと同様「空配列は省略」の契約に従って落とす
  if (node.children && node.children.length > 0) {
    filtered.children = node.children.map(filterNode);
  }

  return filtered;
}

/**
 * inspect のレスポンスをスタイル特化の形に変換する。
 * ノードツリーからスタイル再現に不要なフィールド（blendMode, constraints,
 * scrollBehavior 等）を除去し、AI エージェントのコンテキストに収まる
 * サイズに抑える。components / componentSets / styles は参照解決に必要な
 * ためそのまま残す。
 */
export function filterStylesResponse(response: FigmaNodesResponse): FigmaNodesResponse {
  const nodes: Record<string, FigmaNodeInfo | null> = {};
  for (const [id, info] of Object.entries(response.nodes)) {
    nodes[id] = info === null ? null : { ...info, document: filterNode(info.document) };
  }
  return { ...response, nodes };
}
