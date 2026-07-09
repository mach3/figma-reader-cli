import { createInterface } from "node:readline/promises";
import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { loginToken } from "./auth.js";

export default defineCommand({
  meta: {
    name: "login",
    description: "Save Figma Personal Access Token",
  },
  args: {
    name: {
      type: "string",
      description:
        "Profile name to save the token under (default: local part of the account email from the Figma API)",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    // プロンプトは stderr に出す。stdout はデータ（JSON）専用にしてパイプ実行時の汚染を防ぐ
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
      const token = await rl.question("Figma Personal Access Token: ");

      const trimmed = token.trim();
      if (!trimmed) {
        outputError(args.pretty, { type: "CUSTOM_ERROR", message: "トークンが空です" });
        return process.exit(1);
      }

      const result = await loginToken(args.name, trimmed);
      if (result.isErr()) {
        outputError(args.pretty, result.error);
        return process.exit(1);
      }

      const name = result.value;
      if (args.pretty) {
        console.log(`トークンを保存しました (profile: ${name})`);
      } else {
        console.log(JSON.stringify({ success: true, name }));
      }
    } finally {
      rl.close();
    }
  },
});
