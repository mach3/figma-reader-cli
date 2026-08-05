import { chmod, rm } from "node:fs/promises";
import * as esbuild from "esbuild";

const outfile = "dist/index.js";

// package.json の bin から直接実行されるため実行ビットが必要。
// watch 時もリビルドごとに出力が置き換わるので onEnd で立て直す。
const chmodBin = {
  name: "chmod-bin",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await chmod(outfile, 0o755);
      }
    });
  },
};

const options = {
  entryPoints: ["src/index.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  // citty / neverthrow はバンドルせず import のまま残す。
  // CLI 本体のみを1ファイルに束ねる方針（tsup の既定挙動を踏襲）。
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  plugins: [chmodBin],
};

await rm("dist", { recursive: true, force: true });

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
}
