import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "figma-reader",
    version: "0.1.0",
    description: "CLI tool for reading Figma design data",
  },
  subCommands: {
    login: () => import("./features/login/index.js").then((m) => m.default),
    me: () => import("./features/me/index.js").then((m) => m.default),
    inspect: () => import("./features/inspect/index.js").then((m) => m.default),
  },
});

runMain(main);
