import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (event, _ctx) => {
    // Extract the last assistant text as a preview
    let preview = "";
    for (const msg of [...event.messages].reverse()) {
      if (msg.role === "assistant" && msg.content) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text) {
            preview = block.text;
            break;
          }
        }
        if (preview) break;
      }
    }

    // Truncate to a reasonable notification length
    const maxLen = 200;
    if (preview.length > maxLen) {
      preview = preview.slice(0, maxLen).trimEnd() + "…";
    }

    await pi.exec("notify-send", [
      "--app-name=pi",
      "--icon=dialog-information",
      "--urgency=low",
      "--expire-time=30000",
      "pi",
      preview || "Agent finished responding",
    ], { timeout: 5000 });
  });
}
