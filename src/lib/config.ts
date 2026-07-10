import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import type { AppError } from "./error.js";

export type Config = {
  /** 旧形式の単一トークン。読み込み時に tokens.default へ正規化されるため、readConfig 以降で参照しない */
  token?: string;
  tokens?: Record<string, string>;
  activeToken?: string;
};

/** 設定ファイルのパスを返す */
export function getConfigPath(): string {
  return join(homedir(), ".config", "figma-reader", "config.json");
}

/**
 * 旧形式 `{ token }` を新形式 `{ tokens, activeToken }` に正規化する（純粋関数）。
 * ディスクへの永続化は行わない。書き込みが発生したタイミングで新形式が保存される
 */
export function normalizeConfig(raw: Config): Config {
  if (raw.tokens) {
    return { tokens: raw.tokens, activeToken: raw.activeToken };
  }
  const legacy = raw.token?.trim();
  if (legacy) {
    return { tokens: { default: legacy }, activeToken: "default" };
  }
  return { tokens: {}, activeToken: raw.activeToken };
}

/**
 * トークンを追加/上書きする（純粋関数）。
 * 既存トークンが 0 件の場合のみ、追加したトークンを自動でアクティブにする
 */
export function addToken(config: Config, name: string, token: string): Config {
  const isFirst = Object.keys(config.tokens ?? {}).length === 0;
  return {
    tokens: { ...(config.tokens ?? {}), [name]: token },
    activeToken: isFirst ? name : config.activeToken,
  };
}

/** TOKEN_NOT_FOUND エラーを保存済みプロファイル一覧付きで組み立てる */
function tokenNotFound(tokens: Record<string, string>, name: string): AppError {
  const available = Object.keys(tokens).join(", ") || "(none)";
  return {
    type: "TOKEN_NOT_FOUND",
    message: `Profile "${name}" not found. Saved profiles: ${available}`,
  };
}

/** アクティブトークンを切り替える（純粋関数）。指定名が存在しなければ TOKEN_NOT_FOUND */
export function switchToken(config: Config, name: string): Result<Config, AppError> {
  const tokens = config.tokens ?? {};
  // JSON.parse 由来のオブジェクトは Object.prototype を継承しているため、
  // "toString" 等の継承キーを誤って存在扱いしないよう own-property で判定する
  if (!Object.hasOwn(tokens, name)) {
    return err(tokenNotFound(tokens, name));
  }
  return ok({ ...config, activeToken: name });
}

/**
 * config.json を読み込み、正規化済みの Config を返す。
 * ファイルが存在しない場合は空の Config を返す。
 * configPath はテスト用に差し替え可能
 */
export async function readConfig(configPath = getConfigPath()): Promise<Result<Config, AppError>> {
  try {
    const content = await readFile(configPath, "utf-8");
    return ok(normalizeConfig(JSON.parse(content) as Config));
  } catch (error: unknown) {
    // ファイルが存在しない場合は空の Config を返す
    if (isNodeError(error) && error.code === "ENOENT") {
      return ok(normalizeConfig({}));
    }
    return err({ type: "CONFIG_READ_ERROR", cause: error });
  }
}

/** Config を config.json に書き込む。ディレクトリがなければ作成する */
export async function writeConfig(
  config: Config,
  configPath = getConfigPath(),
): Promise<Result<void, AppError>> {
  try {
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    return ok(undefined);
  } catch (error: unknown) {
    return err({ type: "CONFIG_WRITE_ERROR", cause: error });
  }
}

/**
 * トークンを解決する。
 * 優先順位: profile 引数（--profile 由来）→ 環境変数 FIGMA_TOKEN → config.json の tokens[activeToken]。
 * 明示的な CLI 引数は暗黙の環境設定より強い、という一般的な CLI 慣習に従う
 */
export async function resolveToken(
  profile?: string,
  configPath = getConfigPath(),
): Promise<Result<string, AppError>> {
  if (!profile) {
    const envToken = process.env.FIGMA_TOKEN?.trim();
    if (envToken) {
      return ok(envToken);
    }
  }

  const configResult = await readConfig(configPath);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  const tokens = configResult.value.tokens ?? {};

  // 明示指定されたプロファイルの不在は UNAUTHENTICATED ではなく TOKEN_NOT_FOUND で区別する
  if (profile && !Object.hasOwn(tokens, profile)) {
    return err(tokenNotFound(tokens, profile));
  }

  // activeToken 未設定、または指す先が存在しない（手編集等）場合は UNAUTHENTICATED。
  // 継承キー（"toString" 等）を拾わないよう own-property のみ参照する
  const name = profile ?? configResult.value.activeToken;
  const token = name && Object.hasOwn(tokens, name) ? tokens[name]?.trim() : undefined;
  return token ? ok(token) : err({ type: "UNAUTHENTICATED" });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
