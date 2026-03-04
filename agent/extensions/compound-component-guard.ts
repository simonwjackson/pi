/**
 * Compound Component Guard Extension
 *
 * Blocks read/edit/write on .tsx/.jsx files until the
 * compound-component-pattern skill has been loaded in the session.
 *
 * Converted from Claude Code PreToolUse hook.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SKILL_NEEDLE = "compound-component-pattern";

export default function (pi: ExtensionAPI) {
	let skillLoaded = false;

	pi.on("tool_result", async (event) => {
		if (skillLoaded) return undefined;

		if (event.toolName === "read") {
			const path = (event.input.path ?? "") as string;
			if (path.includes(SKILL_NEEDLE) && path.endsWith("SKILL.md")) {
				skillLoaded = true;
			}
		}
		return undefined;
	});

	pi.on("tool_call", async (event) => {
		if (skillLoaded) return undefined;

		const toolName = event.toolName;
		if (toolName !== "read" && toolName !== "edit" && toolName !== "write") {
			return undefined;
		}

		const path = (event.input.path ?? "") as string;
		if (!path.match(/\.(tsx|jsx)$/)) {
			return undefined;
		}

		return {
			block: true,
			reason:
				"You must load the compound-component-pattern skill before editing React component files. " +
				"Read the compound-component-pattern/SKILL.md file, then retry.",
		};
	});
}
