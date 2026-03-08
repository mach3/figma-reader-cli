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

/** GET /v1/images/:key のレスポンス */
export type FigmaImagesResponse = {
  err: string | null;
  images: Record<string, string | null>;
};

/** Retry-After ヘッダーを秒数として解析する。無効な値の場合は undefined を返す */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number.parseInt(trimmed, 10);
}

/** Figma API に GET リクエストを送る */
export async function figmaGet<T>(token: string, path: string): Promise<Result<T, AppError>> {
  try {
    const response = await fetch(`${FIGMA_API_BASE}${path}`, {
      headers: { "X-Figma-Token": token },
    });

    if (!response.ok) {
      const body = await response.text();
      const retryAfter =
        response.status === 429 || response.status === 503
          ? parseRetryAfter(response.headers.get("retry-after"))
          : undefined;
      return err({
        type: "API_ERROR",
        status: response.status,
        message: body,
        ...(retryAfter !== undefined && { retryAfter }),
      });
    }

    const data = (await response.json()) as T;
    return ok(data);
  } catch (error: unknown) {
    return err({ type: "NETWORK_ERROR", cause: error });
  }
}
