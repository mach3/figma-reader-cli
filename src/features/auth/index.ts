import { defineCommand } from "citty";

export default defineCommand({
  meta: {
    name: "auth",
    description: "Manage Figma authentication tokens",
  },
  subCommands: {
    login: () => import("./login.js").then((m) => m.default),
    switch: () => import("./switch.js").then((m) => m.default),
    list: () => import("./list.js").then((m) => m.default),
    status: () => import("./status.js").then((m) => m.default),
  },
});
