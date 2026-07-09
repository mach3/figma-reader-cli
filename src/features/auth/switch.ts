import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { switchActiveToken } from "./auth.js";

export default defineCommand({
  meta: {
    name: "switch",
    description: "Switch the active token profile",
  },
  args: {
    name: {
      type: "positional",
      required: true,
      description: "Profile name to activate",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const result = await switchActiveToken(args.name);
    if (result.isErr()) {
      outputError(args.pretty, result.error);
      return process.exit(1);
    }

    if (args.pretty) {
      console.log(`アクティブトークンを "${args.name}" に切り替えました`);
    } else {
      console.log(JSON.stringify({ success: true, active: args.name }));
    }
  },
});
