import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import type { TokenProfile } from "./auth.js";
import { listProfiles } from "./auth.js";

export default defineCommand({
  meta: {
    name: "list",
    description: "List saved token profiles",
  },
  args: {
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const result = await listProfiles();
    if (result.isErr()) {
      outputError(args.pretty, result.error);
      return process.exit(1);
    }

    if (args.pretty) {
      formatProfiles(result.value);
    } else {
      console.log(JSON.stringify(result.value));
    }
  },
});

function formatProfiles(profiles: TokenProfile[]): void {
  if (profiles.length === 0) {
    console.log("No saved tokens");
    return;
  }
  for (const profile of profiles) {
    const marker = profile.active ? "*" : " ";
    console.log(`${marker} ${profile.name}  ${profile.masked}`);
  }
}
