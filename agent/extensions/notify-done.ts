import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, _ctx) => {
    await pi.exec("notify-send", [
      "--app-name=pi",
      "--icon=dialog-information",
      "--urgency=low",
      "pi",
      "Agent finished responding",
    ], { timeout: 5000 });
  });
}
