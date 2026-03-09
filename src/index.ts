import { createRequire } from "node:module";
import { defineCommand, runMain } from "citty";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const main = defineCommand({
  meta: {
    name: "figma-reader",
    version,
    description: "CLI tool for reading Figma design data",
  },
  subCommands: {
    login: () => import("./features/login/index.js").then((m) => m.default),
    me: () => import("./features/me/index.js").then((m) => m.default),
    inspect: () => import("./features/inspect/index.js").then((m) => m.default),
    export: () => import("./features/export/index.js").then((m) => m.default),
    install: () => import("./features/install/index.js").then((m) => m.default),
  },
});

runMain(main);
