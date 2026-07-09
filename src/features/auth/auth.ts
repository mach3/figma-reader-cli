import type { Result } from "neverthrow";
import { err, ok } from "neverthrow";
import { addToken, readConfig, resolveToken, switchToken, writeConfig } from "../../lib/config.js";
import type { AppError } from "../../lib/error.js";
import type { FigmaUser } from "../../lib/figma-client.js";
import { getMe } from "../me/me.js";

export type TokenProfile = {
  name: string;
  masked: string;
  active: boolean;
};

/**
 * トークンをマスク表示用に加工する。
 * トークン本体を出力しないため、先頭 8 文字のみ残す（短いトークンは全部伏せる）
 */
export function maskToken(token: string): string {
  if (token.length <= 12) {
    return "***";
  }
  return `${token.slice(0, 8)}...`;
}

/** トークンを指定名で保存する。同名は上書き。初回保存時は自動でアクティブになる */
export async function saveToken(
  name: string,
  token: string,
  configPath?: string,
): Promise<Result<void, AppError>> {
  const configResult = await readConfig(configPath);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  return writeConfig(addToken(configResult.value, name, token), configPath);
}

/**
 * トークンをログイン保存する。
 * name 未指定時は /v1/me のメールアドレスのローカル部をプロファイル名に使う（gh と同じ発想）。
 * handle（表示名）はスペースや日本語を含みうるため、CLI で扱いやすい email 由来とする。
 * 別アカウントのトークンなら自然に別名になり、既存プロファイルと衝突しない。
 * 保存に使ったプロファイル名を返す
 */
export async function loginToken(
  name: string | undefined,
  token: string,
  configPath?: string,
): Promise<Result<string, AppError>> {
  let profileName = name;
  if (!profileName) {
    const userResult = await getMe(token);
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    profileName = userResult.value.email.split("@")[0];
  }

  const saved = await saveToken(profileName, token, configPath);
  if (saved.isErr()) {
    return err(saved.error);
  }
  return ok(profileName);
}

/** アクティブトークンを切り替える */
export async function switchActiveToken(
  name: string,
  configPath?: string,
): Promise<Result<void, AppError>> {
  const configResult = await readConfig(configPath);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  const switched = switchToken(configResult.value, name);
  if (switched.isErr()) {
    return err(switched.error);
  }
  return writeConfig(switched.value, configPath);
}

/** 保存済みトークンをマスク済みの一覧として返す */
export async function listProfiles(configPath?: string): Promise<Result<TokenProfile[], AppError>> {
  const configResult = await readConfig(configPath);
  if (configResult.isErr()) {
    return err(configResult.error);
  }
  const { tokens, activeToken } = configResult.value;
  const profiles = Object.entries(tokens ?? {}).map(([name, token]) => ({
    name,
    masked: maskToken(token),
    active: name === activeToken,
  }));
  return ok(profiles);
}

/**
 * アクティブトークンの有効性を Figma API `/v1/me` で確認する。
 * profile は環境変数由来なら "env"、それ以外は config の activeToken 名
 */
export async function checkStatus(
  configPath?: string,
): Promise<Result<{ profile: string; user: FigmaUser }, AppError>> {
  const tokenResult = await resolveToken(configPath);
  if (tokenResult.isErr()) {
    return err(tokenResult.error);
  }

  const userResult = await getMe(tokenResult.value);
  if (userResult.isErr()) {
    return err(userResult.error);
  }

  let profile = "env";
  if (!process.env.FIGMA_TOKEN?.trim()) {
    const configResult = await readConfig(configPath);
    profile = configResult.isOk() ? (configResult.value.activeToken ?? "") : "";
  }

  return ok({ profile, user: userResult.value });
}
