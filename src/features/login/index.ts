import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { readConfig, writeConfig } from "../../lib/config.js";
import { formatError, outputError } from "../../lib/error.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Figma Personal Access Token を保存する",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "JSON形式で出力",
    },
  },
  async run({ args }) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const token = await rl.question("Figma Personal Access Token: ");

      const trimmed = token.trim();
      if (!trimmed) {
        outputError(args.json, "トークンが空です");
        return process.exit(1);
      }

      // 既存の config を読み込んでマージ
      const configResult = await readConfig();
      if (configResult.isErr()) {
        outputError(args.json, formatError(configResult.error));
        return process.exit(1);
      }

      const writeResult = await writeConfig({ ...configResult.value, token: trimmed });
      if (writeResult.isErr()) {
        outputError(args.json, formatError(writeResult.error));
        return process.exit(1);
      }

      if (args.json) {
        console.log(JSON.stringify({ success: true }));
      } else {
        console.log("トークンを保存しました");
      }
    } finally {
      rl.close();
    }
  },
});
