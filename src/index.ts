import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { runDeepworkCommand } from "./controller.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("deepwork", {
    description: "Run the deterministic QRSPI deepwork pipeline.",
    handler: async (args, ctx) => {
      await runDeepworkCommand(pi, args, ctx);
    },
  });
}
