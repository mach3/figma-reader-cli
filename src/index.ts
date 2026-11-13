import { createRequire } from "node:module";
import { defineCommand, runMain } from "citty";
import { enableProxyFromEnv } from "./lib/proxy.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const main = defineCommand({
  meta: {
    name: "figma-reader",
    version,
    description: "CLI tool for reading Figma design data",
  },
  subCommands: {
    auth: () => import("./features/auth/index.js").then((m) => m.default),
    // login は auth login のエイリアス（後方互換のため残す）
    login: () => import("./features/auth/login.js").then((m) => m.default),
    me: () => import("./features/me/index.js").then((m) => m.default),
    inspect: () => import("./features/inspect/index.js").then((m) => m.default),
    export: () => import("./features/export/index.js").then((m) => m.default),
    install: () => import("./features/install/index.js").then((m) => m.default),
  },
});

// サブコマンドは動的 import なので、ここで await しないと最初の fetch に間に合わない。
// 位置を runMain の後ろや各コマンドの中へ移さないこと
await enableProxyFromEnv();

runMain(main);
