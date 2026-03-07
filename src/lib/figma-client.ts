import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "./error.js";

const FIGMA_API_BASE = "https://api.figma.com";

export type FigmaUser = {
  id: string;
  email: string;
  handle: string;
  img_url: string;
};

/** Figma ノードの基本型 */
export type FigmaNode = {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  absoluteRenderBounds?: { x: number; y: number; width: number; height: number };
  characters?: string;
  fills?: unknown[];
  strokes?: unknown[];
  fillGeometry?: unknown[];
  strokeGeometry?: unknown[];
  [key: string]: unknown;
};

/** GET /v1/files/:key/nodes の個別ノード情報 */
export type FigmaNodeInfo = {
  document: FigmaNode;
  components: Record<string, unknown>;
  componentSets: Record<string, unknown>;
  schemaVersion: number;
  styles: Record<string, unknown>;
};

/** GET /v1/files/:key/nodes のレスポンス */
export type FigmaNodesResponse = {
  name: string;
  role: string;
  lastModified: string;
  editorType: string;
  thumbnailUrl: string;
  err: string | null;
  nodes: Record<string, FigmaNodeInfo | null>;
};

/** Figma API に GET リクエストを送る */
export async function figmaGet<T>(token: string, path: string): Promise<Result<T, AppError>> {
  try {
    const response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { "X-Figma-Token": token },
    });

    if (!response.ok) {
      const body = await response.text();
      return err({ type: "API_ERROR", status: response.status, message: body });
    }

    const data = (await response.json()) as T;
    return ok(data);
  } catch (error: unknown) {
    return err({ type: "NETWORK_ERROR", cause: error });
  }
}
