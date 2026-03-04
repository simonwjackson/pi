/**
 * Startup Context Extension
 *
 * Replicates Claude Code's automatic session-start context injection:
 * git status, recent commits, repo info, package.json summary,
 * tsconfig, justfile recipes, linter config, and directory structure.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

async function run(pi: ExtensionAPI, cmd: string, args: string[]): Promise<string> {
	const { stdout, code } = await pi.exec(cmd, args);
	return code === 0 ? stdout.trim() : "";
}

function readJson(path: string): Record<string, unknown> | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function summarizeDeps(deps: Record<string, string> | undefined, label: string): string {
	if (!deps || Object.keys(deps).length === 0) return "";
	const names = Object.keys(deps).map((d) => `- ${d}`).join("\n");
	return `**${label}:**\n${names}`;
}

/**
 * Build a compact brace-expansion representation of a directory tree.
 * Groups sibling directories with shared substructure into patterns like:
 *   domains/{foo,bar,baz}/{api,data,ui}
 */
function compactDirTree(dirs: string[]): string {
	// Build a tree structure from flat paths
	interface DirNode {
		children: Map<string, DirNode>;
	}
	const root: DirNode = { children: new Map() };

	for (const dir of dirs) {
		const parts = dir.split("/");
		let node = root;
		for (const part of parts) {
			if (!node.children.has(part)) {
				node.children.set(part, { children: new Map() });
			}
			node = node.children.get(part)!;
		}
	}

	// Serialize a node's children into a compact string.
	// Returns a list of path strings for this level.
	function serialize(node: DirNode): string[] {
		if (node.children.size === 0) return [];

		// Group children by their serialized subtree shape
		const shapeGroups = new Map<string, string[]>();
		const childSerialized = new Map<string, string[]>();

		for (const [name, child] of node.children) {
			const sub = serialize(child);
			childSerialized.set(name, sub);
			const shape = sub.join("\n");
			if (!shapeGroups.has(shape)) shapeGroups.set(shape, []);
			shapeGroups.get(shape)!.push(name);
		}

		const lines: string[] = [];

		for (const [shape, names] of shapeGroups) {
			const prefix = names.length === 1 ? names[0] : `{${names.join(",")}}`;
			const subLines = childSerialized.get(names[0])!;

			if (subLines.length === 0) {
				lines.push(prefix);
			} else if (subLines.length === 1 && !subLines[0].includes("\n")) {
				// Single child path — collapse into one line
				lines.push(`${prefix}/${subLines[0]}`);
			} else {
				// Multiple sub-paths — show prefix then indent or collapse
				// If all sub-paths are leaves (no further nesting), use brace expansion
				const allLeaves = subLines.every((s) => !s.includes("/"));
				if (allLeaves && subLines.length > 1) {
					lines.push(`${prefix}/{${subLines.join(",")}}`);
				} else if (allLeaves && subLines.length === 1) {
					lines.push(`${prefix}/${subLines[0]}`);
				} else {
					for (const sub of subLines) {
						lines.push(`${prefix}/${sub}`);
					}
				}
			}
		}

		return lines;
	}

	return serialize(root).join("\n");
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();

	pi.on("before_agent_start", async (event) => {
		// Only inject once per session — check if we already did
		const marker = "## Git Status";
		if (event.systemPrompt.includes(marker)) return undefined;

		const sections: string[] = [];

		// --- Git Status ---
		const status = await run(pi, "git", ["status", "--short"]);
		if (status) {
			sections.push(`## Git Status\n\n\`\`\`\n${status}\n\`\`\``);
		}

		// --- Recent Commits ---
		const log = await run(pi, "git", ["log", "--oneline", "-10"]);
		if (log) {
			sections.push(`## Recent Commits\n\n\`\`\`\n${log}\n\`\`\``);
		}

		// --- Current Branch ---
		const branch = await run(pi, "git", ["branch", "--show-current"]);
		if (branch) {
			sections.push(`## Current Branch\n\n${branch}`);
		}

		// --- Repository Info (onefetch) ---
		const onefetch = await run(pi, "nix", [
			"shell", "nixpkgs#onefetch", "--command", "onefetch", "--no-art", "--no-color-palette",
		]);
		if (onefetch) {
			sections.push(`## Repository Info\n\n\`\`\`\n${onefetch}\n\`\`\``);
		}

		// --- package.json ---
		const pkg = readJson(join(cwd, "package.json")) as {
			name?: string;
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		} | null;
		if (pkg) {
			const parts = [];
			if (pkg.name) parts.push(`**Name:** ${pkg.name}`);
			const deps = summarizeDeps(pkg.dependencies, "Dependencies");
			const devDeps = summarizeDeps(pkg.devDependencies, "Dev Dependencies");
			if (deps) parts.push(deps);
			if (devDeps) parts.push(devDeps);
			if (parts.length > 0) {
				sections.push(`## package.json\n\n${parts.join("\n\n")}`);
			}
		}

		// --- TypeScript Config ---
		const tsconfig = readJson(join(cwd, "tsconfig.json"));
		if (tsconfig) {
			const ext = tsconfig.extends ? `- Extends: \`${tsconfig.extends}\`` : "";
			const strict = (tsconfig as any).compilerOptions?.strict ? "- Strict: true" : "";
			const parts = [ext, strict].filter(Boolean);
			if (parts.length > 0) {
				sections.push(`## TypeScript Config\n\n${parts.join("\n")}`);
			}
		}

		// --- Justfile Recipes ---
		const recipes = await run(pi, "just", ["--list"]);
		if (recipes) {
			sections.push(`## Justfile Recipes\n\n\`\`\`\n${recipes}\n\`\`\``);
		}

		// --- Biome Config ---
		if (existsSync(join(cwd, "biome.json"))) {
			sections.push(`## Linter\n\nBiome (see biome.json)`);
		}

		// --- Directory Structure (compact, token-efficient) ---
		const tree = await run(pi, "find", [
			cwd, "-maxdepth", "3",
			"-not", "-path", "*/node_modules/*",
			"-not", "-path", "*/.git/*",
			"-not", "-path", "*/dist/*",
			"-not", "-path", "*/.next/*",
			"-not", "-path", "*/.nuxt/*",
			"-not", "-path", "*/.turbo/*",
			"-not", "-path", "*/.cache/*",
			"-not", "-path", "*/coverage/*",
			"-not", "-path", "*/__pycache__/*",
			"-not", "-name", "node_modules",
			"-not", "-name", ".git",
			"-type", "d",
		]);
		if (tree) {
			const dirs = tree
				.split("\n")
				.map((d) => d.replace(cwd, "").replace(/^\//, ""))
				.filter((d) => d.length > 0)
				.sort();
			const compactTree = compactDirTree(dirs);
			sections.push(`## Directory Structure\n\n\`\`\`\n${compactTree}\n\`\`\``);
		}

		if (sections.length === 0) return undefined;

		const context = `\n\n# Project Context (auto-generated)\n\n${sections.join("\n\n")}`;

		return { systemPrompt: event.systemPrompt + context };
	});
}
