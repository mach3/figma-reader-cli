import { join, relative } from "node:path";
import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { copySkills, getSkillSourceDir } from "./install.js";

export default defineCommand({
  meta: {
    name: "install",
    description: "Install skill files for AI agents",
  },
  args: {
    pretty: {
      type: "boolean",
      default: false,
      description: "Output in human-readable text format",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const sourceDir = getSkillSourceDir();
    const destDir = join(cwd, ".claude", "skills", "figma-reader-cli");

    const result = await copySkills(sourceDir, destDir);

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
