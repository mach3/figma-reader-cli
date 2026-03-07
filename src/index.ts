import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "figma-reader",
    version: "0.1.0",
    description: "CLI tool for reading Figma design data",
  },
  run() {
    console.log("Hello, World!");
  },
});

runMain(main);
