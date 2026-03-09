import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { readConfig, writeConfig } from "../../lib/config.js";
import { outputError } from "../../lib/error.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Save Figma Personal Access Token",
  },
  args: {
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const token = await rl.question("Figma Personal Access Token: ");

      const trimmed = token.trim();
      if (!trimmed) {
        outputError(args.pretty, { type: "CUSTOM_ERROR", message: "トークンが空です" });
        return process.exit(1);
      }

      // 既存の config を読み込んでマージ
      const configResult = await readConfig();
      if (configResult.isErr()) {
        outputError(args.pretty, configResult.error);
        return process.exit(1);
      }

      const writeResult = await writeConfig({ ...configResult.value, token: trimmed });
      if (writeResult.isErr()) {
        outputError(args.pretty, writeResult.error);
        return process.exit(1);
      }

      if (args.pretty) {
        console.log("トークンを保存しました");
      } else {
        console.log(JSON.stringify({ success: true }));
      }
    } finally {
      rl.close();
    }
  },
});
