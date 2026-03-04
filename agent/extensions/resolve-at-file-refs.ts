/**
 * Resolve @file References Extension
 *
 * Replicates Claude Code's @file auto-include for AGENTS.md.
 * Scans the system prompt for @path references and replaces them
 * inline with the referenced file's content, recursively.
 *
 * Also coexists with pi-subdir-context by removing duplicate
 * "Loaded subdirectory context from .../AGENTS.md" blocks when
 * those AGENTS.md files were already inlined into the system prompt.
 */

import { existsSync, readFileSync, realpathSync } from "fs";
import { basename, dirname, isAbsolute, resolve } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MAX_DEPTH = 10;
const SUBDIR_CONTEXT_RE = /^Loaded subdirectory context from ([^\n]+)\n\n/s;

/**
 * Match @file references:
 *   @AGENTS.md
 *   @docs/README.md
 *   @./relative/path.md
 *   - @docs/philosophy.md — trailing text is fine
 *
 * Captures the full match (including leading whitespace/punctuation)
 * and the path separately so we can do in-place replacement.
 */
const AT_FILE_RE = /(^|[\s\-\*])@((?:\.{0,2}\/)?[\w\-\.\/]+\.\w+)/gm;

function canonicalizePath(path: string): string {
	const abs = isAbsolute(path) ? path : resolve(path);
	try {
		return realpathSync(abs);
	} catch {
		return abs;
	}
}

function resolveContent(
	text: string,
	baseDir: string,
	rootDir: string,
	seen: Set<string>,
	inlinedFiles: Set<string>,
	depth: number,
): string {
	if (depth > MAX_DEPTH) return text;

	return text.replace(AT_FILE_RE, (fullMatch, prefix: string, ref: string) => {
		let absPath = isAbsolute(ref) ? ref : resolve(baseDir, ref);

		// Fall back to project root if not found relative to the including file
		if (!existsSync(absPath) && baseDir !== rootDir) {
			absPath = resolve(rootDir, ref);
		}

		if (!existsSync(absPath)) {
			return fullMatch; // leave unresolved refs as-is
		}

		const canonicalPath = canonicalizePath(absPath);
		if (seen.has(canonicalPath)) {
			return fullMatch;
		}

		seen.add(canonicalPath);

		try {
			const content = readFileSync(canonicalPath, "utf-8");
			inlinedFiles.add(canonicalPath);
			// Recurse from the included file's directory
			const resolved = resolveContent(content, dirname(canonicalPath), rootDir, seen, inlinedFiles, depth + 1);
			return `${prefix}${resolved}`;
		} catch {
			return fullMatch;
		}
	});
}

export default function (pi: ExtensionAPI) {
	const cwd = canonicalizePath(process.cwd());
	let inlinedAgents = new Set<string>();

	pi.on("before_agent_start", async (event) => {
		const original = event.systemPrompt;
		if (!original) return undefined;

		const inlinedFiles = new Set<string>();
		const resolved = resolveContent(original, cwd, cwd, new Set(), inlinedFiles, 0);

		inlinedAgents = new Set(
			[...inlinedFiles].filter((file) => basename(file).toLowerCase() === "agents.md"),
		);

		if (resolved === original) return undefined;

		return { systemPrompt: resolved };
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "read" || event.isError || inlinedAgents.size === 0) {
			return undefined;
		}
		if (!Array.isArray(event.content) || event.content.length === 0) {
			return undefined;
		}

		let changed = false;
		const filteredContent = event.content.filter((part) => {
			if (part.type !== "text") return true;
			const match = part.text.match(SUBDIR_CONTEXT_RE);
			if (!match) return true;

			const agentsPath = canonicalizePath(match[1].trim());
			if (!inlinedAgents.has(agentsPath)) return true;

			changed = true;
			return false;
		});

		if (!changed) return undefined;

		return {
			content: filteredContent,
			details: event.details,
			isError: event.isError,
		};
	});
}
