import { relative } from "node:path";
import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { AGENT_NAMES, copySkills, getSkillSourceDir, resolveInstallDir } from "./install.js";

export default defineCommand({
  meta: {
    name: "install",
    description: "Install skill files for AI agents",
  },
  args: {
    agent: {
      type: "string",
      description: `Target agent: ${AGENT_NAMES.join(", ")} (default: claude)`,
    },
    dest: {
      type: "string",
      description: "Install to an arbitrary path (cannot be used with --agent)",
    },
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();

    const destResult = resolveInstallDir({ cwd, agent: args.agent, dest: args.dest });
    if (destResult.isErr()) {
      outputError(args.pretty, destResult.error);
      return process.exit(1);
    }
    const destDir = destResult.value;

    const result = await copySkills(getSkillSourceDir(), destDir);

    if (result.isErr()) {
      outputError(args.pretty, result.error);
      return process.exit(1);
    }

    if (args.pretty) {
      console.log(`Skills installed to ${relative(cwd, destDir)}`);
    } else {
      console.log(JSON.stringify({ success: true, path: relative(cwd, destDir) }));
    }
  },
});
