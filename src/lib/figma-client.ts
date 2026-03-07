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
