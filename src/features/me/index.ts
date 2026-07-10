import { defineCommand } from "citty";
import { resolveToken } from "../../lib/config.js";
import { outputError } from "../../lib/error.js";
import type { FigmaUser } from "../../lib/figma-client.js";
import { getMe } from "./me.js";

export default defineCommand({
  meta: {
    name: "me",
    description: "Get authenticated Figma user info",
  },
  args: {
    profile: {
      type: "string",
      description:
        "Profile name to use for this run (overrides FIGMA_TOKEN and the active profile)",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const tokenResult = await resolveToken(args.profile);
    if (tokenResult.isErr()) {
      outputError(args.pretty, tokenResult.error);
      return process.exit(1);
    }

    const meResult = await getMe(tokenResult.value);
    if (meResult.isErr()) {
      outputError(args.pretty, meResult.error);
      return process.exit(1);
    }

    const user = meResult.value;
    if (args.pretty) {
      formatUser(user);
    } else {
      console.log(JSON.stringify(user));
    }
  },
});

function formatUser(user: FigmaUser): void {
  console.log(`ID:     ${user.id}`);
  console.log(`Handle: ${user.handle}`);
  console.log(`Email:  ${user.email}`);
  console.log(`Avatar: ${user.img_url}`);
}
