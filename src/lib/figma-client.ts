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

/** Variables API: 変数の値（カラー） */
export type FigmaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

/** Variables API: 他の変数へのエイリアス参照 */
export type FigmaVariableAlias = {
  type: "VARIABLE_ALIAS";
  id: string;
};

/** Variables API: 変数の値 */
export type FigmaVariableValue = boolean | number | string | FigmaColor | FigmaVariableAlias;

/** Variables API: 変数 */
export type FigmaVariable = {
  id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR";
  valuesByMode: Record<string, FigmaVariableValue>;
  remote: boolean;
  description: string;
  hiddenFromPublishing: boolean;
  scopes: string[];
  codeSyntax: Record<string, string>;
  [key: string]: unknown;
};

/** Variables API: 公開済み変数（値情報なし） */
export type FigmaPublishedVariable = {
  id: string;
  subscribed_id: string;
  name: string;
  key: string;
  variableCollectionId: string;
  resolvedType: "BOOLEAN" | "FLOAT" | "STRING" | "COLOR";
  updatedAt: string;
  [key: string]: unknown;
};

/** Variables API: 変数コレクション */
export type FigmaVariableCollection = {
  id: string;
  name: string;
  key: string;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  remote: boolean;
  hiddenFromPublishing: boolean;
  variableIds: string[];
  [key: string]: unknown;
};

/** Variables API: 公開済みコレクション */
export type FigmaPublishedVariableCollection = {
  id: string;
  subscribed_id: string;
  name: string;
  key: string;
  updatedAt: string;
  [key: string]: unknown;
};

/** GET /v1/files/:key/variables/local のレスポンス */
export type FigmaLocalVariablesResponse = {
  status: number;
  error: boolean;
  meta: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
};

/** GET /v1/files/:key/variables/published のレスポンス */
export type FigmaPublishedVariablesResponse = {
  status: number;
  error: boolean;
  meta: {
    variables: Record<string, FigmaPublishedVariable>;
    variableCollections: Record<string, FigmaPublishedVariableCollection>;
  };
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
