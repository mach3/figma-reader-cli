import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { checkStatus } from "./auth.js";

export default defineCommand({
  meta: {
    name: "status",
    description: "Check active token validity",
  },
  args: {
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const result = await checkStatus();
    if (result.isErr()) {
      outputError(args.pretty, result.error);
      return process.exit(1);
    }

    const { profile, user } = result.value;
    if (args.pretty) {
      console.log(`✓ Logged in as ${user.handle} (${user.email})`);
      console.log(`  Profile: ${profile}`);
    } else {
      console.log(JSON.stringify({ success: true, profile, user }));
    }
  },
});
