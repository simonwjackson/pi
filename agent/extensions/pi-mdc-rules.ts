/**
 * MDC Rules Extension for pi-coding-agent
 *
 * Loads rules from .agents/rules/*.md and applies them based on frontmatter:
 *
 *   trigger: always_on     → injected into system prompt every turn
 *   trigger: glob          → blocks read/write/edit unless all matching rules
 *                            are already present in context via <file-rules> tag
 *   trigger: model_decision → listed in system prompt for on-demand reading
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Rule {
	name: string;
	filePath: string;
	content: string;
	globs?: string[];
	alwaysApply: boolean;
	description?: string;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!match) return { meta: {}, body: raw.trim() };

	const yamlBlock = match[1];
	const body = match[2].trim();
	const meta: Record<string, unknown> = {};

	const lines = yamlBlock.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) {
			i++;
			continue;
		}

		const key = line.slice(0, colonIdx).trim();
		const rest = line.slice(colonIdx + 1).trim();

		// Multiline block scalars: `|` (literal) or `>` (folded)
		if (rest === "|" || rest === ">") {
			const folded = rest === ">";
			const blockLines: string[] = [];
			i++;
			while (i < lines.length && (lines[i] === "" || /^\s+/.test(lines[i]))) {
				blockLines.push(lines[i].replace(/^\s+/, ""));
				i++;
			}
			const joined = folded
				? blockLines.join(" ").replace(/\s+/g, " ").trim()
				: blockLines.join("\n").trim();
			if (joined) meta[key] = joined;
			continue;
		}

		if (rest === "" || rest === "[]") {
			const items: string[] = [];
			i++;
			while (i < lines.length && /^\s+-\s/.test(lines[i])) {
				items.push(lines[i].replace(/^\s+-\s+/, "").replace(/^['"]|['"]$/g, "").trim());
				i++;
			}
			if (items.length > 0) meta[key] = items;
			continue;
		}

		if (rest.startsWith("[")) {
			const inner = rest.slice(1, rest.lastIndexOf("]"));
			meta[key] = inner.split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
		} else if (rest === "true") {
			meta[key] = true;
		} else if (rest === "false") {
			meta[key] = false;
		} else {
			meta[key] = rest.replace(/^['"]|['"]$/g, "");
		}
		i++;
	}

	return { meta, body };
}

function parseGlobs(value: unknown): string[] | undefined {
	if (!value) return undefined;
	if (typeof value === "string") {
		const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
		return parts.length > 0 ? parts : undefined;
	}
	if (Array.isArray(value)) {
		const parts = value.filter((s): s is string => typeof s === "string" && s.trim().length > 0);
		return parts.length > 0 ? parts : undefined;
	}
	return undefined;
}

// ─── Glob matching ────────────────────────────────────────────────────────────

/**
 * Expand brace patterns like `*.{ts,tsx}` into multiple globs: `["*.ts", "*.tsx"]`.
 * Handles one level of braces (no nesting).
 */
function expandBraces(glob: string): string[] {
	const match = glob.match(/^(.*)\{([^}]+)\}(.*)$/);
	if (!match) return [glob];
	const [, prefix, alternatives, suffix] = match;
	return alternatives.split(",").map((alt) => `${prefix}${alt.trim()}${suffix}`);
}

function globToRegex(glob: string): RegExp {
	const escaped = glob
		.replace(/^\.\//, "")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "\x00")
		.replace(/\*/g, "[^/]*")
		.replace(/\x00/g, ".*")
		.replace(/\?/g, "[^/]");
	return new RegExp(`^${escaped}$`);
}

function matchesGlob(filePath: string, glob: string): boolean {
	const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
	const expanded = expandBraces(glob);
	for (const g of expanded) {
		const regex = globToRegex(g);
		if (regex.test(normalized)) return true;
		if (!g.includes("/")) {
			if (regex.test(path.basename(normalized))) return true;
		}
	}
	return false;
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
	return globs.some((g) => matchesGlob(filePath, g));
}

// ─── Rule loading ─────────────────────────────────────────────────────────────

function loadRulesFromDir(dirPath: string): Rule[] {
	if (!fs.existsSync(dirPath)) return [];

	let files: string[];
	try {
		files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".md"));
	} catch {
		return [];
	}

	const rules: Rule[] = [];
	for (const file of files) {
		const filePath = path.join(dirPath, file);
		try {
			const raw = fs.readFileSync(filePath, "utf-8");
			const { meta, body } = parseFrontmatter(raw);
			if (!body) continue;
			const trigger = typeof meta.trigger === "string" ? meta.trigger : "";
			rules.push({
				name: file.replace(/\.md$/, ""),
				filePath,
				content: body,
				globs: trigger === "glob" ? parseGlobs(meta.globs) : undefined,
				alwaysApply: trigger === "always_on",
				description: typeof meta.description === "string" ? meta.description : undefined,
			});
		} catch {
			// skip unreadable files
		}
	}

	return rules;
}

function contentHash(rules: Rule[]): string {
	const combined = rules.map((r) => r.content).join("\n");
	return crypto.createHash("sha256").update(combined).digest("hex").slice(0, 8);
}

// ─── Context checking ─────────────────────────────────────────────────────────

/**
 * Build the <file-rules> tag for a given file and its matching rules.
 * The `rules` attribute lists all rule names for quick validation.
 * The `hash` attribute ensures changed content invalidates old tags.
 */
function buildFileRulesTag(filePath: string, matchingRules: Rule[]): string {
	const names = matchingRules.map((r) => r.name).sort().join(",");
	const hash = contentHash(matchingRules);
	const rulesText = matchingRules.map((r) => `### ${r.name}\n\n${r.content}`).join("\n\n---\n\n");
	return `<file-rules path="${filePath}" rules="${names}" hash="${hash}">\n${rulesText}\n</file-rules>`;
}

/**
 * Check if the conversation context contains a <file-rules> tag for this file
 * that includes ALL the required rule names with matching content hash.
 */
function contextHasAllRules(
	filePath: string,
	requiredNames: string[],
	hash: string,
	sessionManager: { getBranch(): { type: string; message?: any }[] },
): boolean {
	const sorted = [...requiredNames].sort().join(",");
	const tagPattern = `<file-rules path="${filePath}" rules="${sorted}" hash="${hash}">`;

	const branch = sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || !entry.message) continue;

		const msg = entry.message;

		// Check in text content of any message type
		const content = msg.content;
		if (typeof content === "string" && content.includes(tagPattern)) {
			return true;
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (typeof part === "string" && part.includes(tagPattern)) return true;
				if (part && typeof part === "object" && "text" in part && typeof part.text === "string" && part.text.includes(tagPattern)) return true;
			}
		}

		// Check in toolResult reason (where blocked tool_call reasons end up)
		if (typeof msg.reason === "string" && msg.reason.includes(tagPattern)) return true;

		// Check in details
		if (msg.details && typeof msg.details === "object") {
			const detailsStr = JSON.stringify(msg.details);
			if (detailsStr.includes(tagPattern)) return true;
		}
	}

	return false;
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function mdcRules(pi: ExtensionAPI) {
	let rules: Rule[] = [];
	let projectCwd = "";

	function reloadRules() {
		rules = [];
		if (!projectCwd) return;

		rules.push(...loadRulesFromDir(path.join(projectCwd, ".agents", "rules")));
	}

	pi.on("session_start", async (_event, ctx) => {
		projectCwd = ctx.cwd;
		reloadRules();

		if (rules.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`MDC rules: ${rules.length} rule(s) loaded`, "info");
		}
	});

	// Append always-apply rules and list glob/on-demand rules in system prompt
	pi.on("before_agent_start", async (event) => {
		reloadRules();
		const always = rules.filter((r) => r.alwaysApply);
		const byGlob = rules.filter((r) => !r.alwaysApply && r.globs?.length);
		const onDemand = rules.filter((r) => !r.alwaysApply && !r.globs?.length && r.description);

		if (!always.length && !byGlob.length && !onDemand.length) return;

		let append = "";

		if (always.length > 0) {
			append += "\n\n## Project Rules\n\n";
			for (const r of always) {
				append += `### ${r.name}\n\n${r.content}\n\n`;
			}
		}

		if (byGlob.length > 0) {
			append += "\n\n## File-Specific Rules\n\n";
			append += "These rules are enforced before you can edit matching files:\n\n";
			for (const r of byGlob) {
				const globs = r.globs!.join(", ");
				const desc = r.description ? ` — ${r.description}` : "";
				append += `- **${r.name}** (\`${globs}\`)${desc}\n`;
			}
		}

		if (onDemand.length > 0) {
			append += "\n\n## Available Rules\n\n";
			append += "Read these files for additional guidance when relevant:\n\n";
			for (const r of onDemand) {
				append += `- **${r.name}**: ${r.description} (\`${r.filePath}\`)\n`;
			}
		}

		return { systemPrompt: event.systemPrompt + append };
	});

	// /mdc command: create a new rule with AI assistance
	pi.registerCommand("mdc", {
		description: "Create a new MDC rule with AI assistance",
		async handler(_args, ctx) {
			if (!ctx.hasUI) {
				ctx.ui.notify("MDC: UI required to create rules", "error");
				return;
			}

			const purpose = await ctx.ui.input("What should this rule enforce?", "e.g. Always use TypeScript strict mode");
			if (!purpose) return;

			const triggerChoice = await ctx.ui.select("Trigger type", [
				"always_on — injected into system prompt every turn",
				"glob — blocks edits on matching files until rule is read",
				"model_decision — agent reads on demand when relevant",
			]);
			if (!triggerChoice) return;

			const trigger = triggerChoice.split(" ")[0] as "always_on" | "glob" | "model_decision";

			let globs: string | undefined;
			if (trigger === "glob") {
				globs = await ctx.ui.input("Which files?", "e.g. *.ts, src/**/*.py");
				if (!globs) return;
			}

			const suggestedName = purpose.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
			const name = await ctx.ui.input("Rule name (no extension)", suggestedName);
			if (!name) return;

			const rulesDir = path.join(ctx.cwd, ".agents", "rules");
			const filePath = path.join(rulesDir, `${name}.md`);

			let frontmatter = `---\ntrigger: ${trigger}\n`;
			if (globs) frontmatter += `globs: "${globs}"\n`;
			if (trigger === "model_decision") frontmatter += `description: <short one-line description>\n`;
			frontmatter += `---`;

			const prompt =
				`Create a new MDC rule file at \`${filePath}\`.\n\n` +
				`Purpose: ${purpose}\n\n` +
				`Use this exact frontmatter:\n\`\`\`\n${frontmatter}\n\`\`\`\n\n` +
				`Write clear, concise rule content below the frontmatter that enforces: ${purpose}` +
				(trigger === "model_decision" ? "\nAlso fill in a short one-line description in the frontmatter." : "");

			pi.sendUserMessage(prompt);
		},
	});

	// On every write/edit to a file matching a glob:
	//   - If context already has a complete <file-rules> tag → allow
	//   - If context has an incomplete <file-rules> tag → block, send complete tag
	//   - If context has no <file-rules> tag → block, send complete tag
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit" && event.toolName !== "read") return;

		const filePath = (event.input.path as string | undefined) ?? "";
		if (!filePath) return;

		// Re-scan rules from disk so new files and edits are picked up
		reloadRules();

		const matching = rules.filter(
			(r) => !r.alwaysApply && r.globs?.length && matchesAnyGlob(filePath, r.globs),
		);
		if (!matching.length) return;

		const requiredNames = matching.map((r) => r.name);
		const hash = contentHash(matching);

		// Check if the context already contains all rules with current content
		if (contextHasAllRules(filePath, requiredNames, hash, ctx.sessionManager)) {
			return; // all rules present, allow the tool through
		}

		const tag = buildFileRulesTag(filePath, matching);

		if (ctx.hasUI) {
			ctx.ui.notify(`MDC: ${matching.length} rule(s) for ${path.basename(filePath)}`, "info");
		}

		return {
			block: true,
			reason: `The following rules apply to "${filePath}". Read them carefully and retry your edit.\n\n${tag}`,
		};
	});
}
