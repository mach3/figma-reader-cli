import { join, relative } from "node:path";
import { defineCommand } from "citty";
import { outputError } from "../../lib/error.js";
import { copySkills, getSkillSourceDir } from "./install.js";

export default defineCommand({
  meta: {
    name: "install",
    description: "AI エージェント用のスキルファイルをインストールする",
  },
  args: {
    pretty: {
      type: "boolean",
      default: false,
      description: "人間向けのテキスト形式で出力",
    },
  },
  async run({ args }) {
    const cwd = process.cwd();
    const sourceDir = getSkillSourceDir();
    const destDir = join(cwd, ".claude", "skills", "figma-reader");

    const result = await copySkills(sourceDir, destDir);

    if (result.isErr()) {
      outputError(args.pretty, result.error);
      return process.exit(1);
    }

    if (args.pretty) {
      console.log(`スキルをインストールしました: ${relative(cwd, destDir)}`);
    } else {
      console.log(JSON.stringify({ success: true, path: relative(cwd, destDir) }));
    }
  },
});
