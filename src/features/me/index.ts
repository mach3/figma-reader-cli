import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { formatError, outputError } from "../../lib/error.js";
import type { FigmaUser } from "../../lib/figma-client.js";
import { getMe } from "./me.js";

export default defineCommand({
  meta: {
    name: "me",
    description: "Figma のユーザー情報を取得する",
  },
  args: {
    json: {
      type: "boolean",
      default: false,
      description: "JSON形式で出力",
    },
  },
  async run({ args }) {
    const tokenResult = await resolveToken();
    if (tokenResult.isErr()) {
      outputError(args.json, formatError(tokenResult.error));
      return process.exit(1);
    }

    const meResult = await getMe(tokenResult.value);
    if (meResult.isErr()) {
      outputError(args.json, formatError(meResult.error));
      return process.exit(1);
    }

    const user = meResult.value;
    if (args.json) {
      console.log(JSON.stringify(user));
    } else {
      formatUser(user);
    }
  },
});

function formatUser(user: FigmaUser): void {
  console.log(`ID:     ${user.id}`);
  console.log(`Handle: ${user.handle}`);
  console.log(`Email:  ${user.email}`);
  console.log(`Avatar: ${user.img_url}`);
}
