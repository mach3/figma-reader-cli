import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "./error.js";

export type Config = {
  token?: string;
};

/** 設定ファイルのパスを返す */
export function getConfigPath(): string {
  return join(homedir(), ".config", "figma-reader", "config.json");
}

/** config.json を読み込む。ファイルが存在しない場合は空の Config を返す */
export async function readConfig(): Promise<Result<Config, AppError>> {
  try {
    const content = await readFile(getConfigPath(), "utf-8");
    return ok(JSON.parse(content) as Config);
  } catch (error: unknown) {
    // ファイルが存在しない場合は空の Config を返す
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok({});
    }
    return err({ type: "CONFIG_READ_ERROR", cause: error });
  }
}

/** Config を config.json に書き込む。ディレクトリがなければ作成する */
export async function writeConfig(config: Config): Promise<Result<void, AppError>> {
  try {
    const configPath = getConfigPath();
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    return ok(undefined);
  } catch (error: unknown) {
    return err({ type: "CONFIG_WRITE_ERROR", cause: error });
  }
}

/**
 * トークンを解決する。
 * 優先順位: 環境変数 FIGMA_TOKEN → config.json の token
 */
export async function resolveToken(): Promise<Result<string, AppError>> {
  const envToken = process.env.FIGMA_TOKEN?.trim();
  if (envToken) {
    return ok(envToken);
  }

  const configResult = await readConfig();
  if (configResult.isErr()) {
    return err(configResult.error);
  }

  const token = configResult.value.token?.trim();
  if (token) {
    return ok(token);
  }

  return err({ type: "UNAUTHENTICATED" });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
