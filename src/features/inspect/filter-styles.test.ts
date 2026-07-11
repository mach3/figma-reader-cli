import { describe, expect, it } from "vitest";
import type { FigmaNode, FigmaNodesResponse } from "../../lib/figma-client.js";
import { filterStylesResponse } from "./filter-styles.js";

function makeResponse(document: Record<string, unknown>): FigmaNodesResponse {
  return {
    name: "TestFile",
    role: "viewer",
    lastModified: "2026-07-11T00:00:00Z",
    editorType: "figma",
    thumbnailUrl: "https://example.com/thumb.png",
    err: null,
    nodes: {
      "1:2": {
        document: document as FigmaNode,
        components: { "10:1": { name: "Button" } },
        componentSets: {},
        schemaVersion: 0,
        styles: { "s:1": { name: "Primary" } },
      },
    },
  };
}

describe("filterStylesResponse", () => {
  it("ノイズフィールドを除去する", () => {
    const response = makeResponse({
      id: "1:2",
      name: "Card",
      type: "FRAME",
      blendMode: "PASS_THROUGH",
      constraints: { vertical: "TOP", horizontal: "LEFT" },
      scrollBehavior: "SCROLLS",
      absoluteRenderBounds: { x: 0, y: 0, width: 320, height: 200 },
      exportSettings: [{ format: "PNG" }],
      fillGeometry: [{ path: "M0 0" }],
      strokeGeometry: [{ path: "M0 0" }],
      clipsContent: true,
      background: [],
    });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "Card", type: "FRAME" });
  });

  it("スタイルフィールドを保持する", () => {
    const styleProps = {
      absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 200 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      strokeWeight: 1,
      strokeAlign: "INSIDE",
      cornerRadius: 8,
      effects: [{ type: "DROP_SHADOW", radius: 4 }],
      opacity: 0.5,
      boundVariables: { fills: [{ type: "VARIABLE_ALIAS", id: "V:1" }] },
      styles: { fill: "s:1" },
    };
    const response = makeResponse({ id: "1:2", name: "Card", type: "FRAME", ...styleProps });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "Card", type: "FRAME", ...styleProps });
  });

  it("Auto Layout とテキストのフィールドを保持する", () => {
    const layoutAndText = {
      layoutMode: "VERTICAL",
      itemSpacing: 8,
      counterAxisSpacing: 24,
      counterAxisAlignContent: "SPACE_BETWEEN",
      layoutWrap: "WRAP",
      layoutPositioning: "ABSOLUTE",
      paddingTop: 16,
      paddingLeft: 16,
      primaryAxisAlignItems: "CENTER",
      characters: "Hello bold world",
      style: { fontFamily: "Inter", fontSize: 16, fontWeight: 600 },
      characterStyleOverrides: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
      styleOverrideTable: { "1": { fontWeight: 700 } },
    };
    const response = makeResponse({ id: "1:2", name: "Title", type: "TEXT", ...layoutAndText });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "Title", type: "TEXT", ...layoutAndText });
  });

  it("rotation と isMask を保持する", () => {
    const shape = { rotation: 0.7853981633974483, isMask: true };
    const response = makeResponse({ id: "1:2", name: "AvatarMask", type: "ELLIPSE", ...shape });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "AvatarMask", type: "ELLIPSE", ...shape });
  });

  it("空の children を出力しない", () => {
    const response = makeResponse({ id: "1:2", name: "EmptyFrame", type: "FRAME", children: [] });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "EmptyFrame", type: "FRAME" });
  });

  it("children を再帰的に変換する", () => {
    const response = makeResponse({
      id: "1:2",
      name: "Card",
      type: "FRAME",
      children: [
        {
          id: "1:3",
          name: "Inner",
          type: "RECTANGLE",
          blendMode: "NORMAL",
          strokeWeight: 2,
          children: [{ id: "1:4", name: "Leaf", type: "VECTOR", scrollBehavior: "SCROLLS" }],
        },
      ],
    });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document?.children).toEqual([
      {
        id: "1:3",
        name: "Inner",
        type: "RECTANGLE",
        strokeWeight: 2,
        children: [{ id: "1:4", name: "Leaf", type: "VECTOR" }],
      },
    ]);
  });

  it("visible: false は保持し visible: true は省略する", () => {
    const response = makeResponse({
      id: "1:2",
      name: "Card",
      type: "FRAME",
      visible: true,
      children: [{ id: "1:3", name: "HiddenBorder", type: "RECTANGLE", visible: false }],
    });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).not.toHaveProperty("visible");
    expect(document?.children?.[0]).toEqual({
      id: "1:3",
      name: "HiddenBorder",
      type: "RECTANGLE",
      visible: false,
    });
  });

  it("空配列のキーを出力しない", () => {
    const response = makeResponse({
      id: "1:2",
      name: "Card",
      type: "FRAME",
      fills: [],
      strokes: [],
      effects: [],
    });

    const document = filterStylesResponse(response).nodes["1:2"]?.document;
    expect(document).toEqual({ id: "1:2", name: "Card", type: "FRAME" });
  });

  it("トップレベルのメタ情報と components / styles を保持する", () => {
    const response = makeResponse({ id: "1:2", name: "Card", type: "FRAME" });

    const filtered = filterStylesResponse(response);
    expect(filtered.name).toBe("TestFile");
    expect(filtered.lastModified).toBe("2026-07-11T00:00:00Z");
    expect(filtered.nodes["1:2"]?.components).toEqual({ "10:1": { name: "Button" } });
    expect(filtered.nodes["1:2"]?.styles).toEqual({ "s:1": { name: "Primary" } });
  });

  it("null ノードをそのまま残す", () => {
    const response = makeResponse({ id: "1:2", name: "Card", type: "FRAME" });
    response.nodes["9:9"] = null;

    const filtered = filterStylesResponse(response);
    expect(filtered.nodes["9:9"]).toBeNull();
  });
});
