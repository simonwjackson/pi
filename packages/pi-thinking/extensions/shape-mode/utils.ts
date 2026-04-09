import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*top\b/,
	/^\s*htop\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python\s+--version/i,
	/^\s*curl\s/i,
	/^\s*wget\s+-O\s*- /i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*awk\b/,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*exa\b/,
];

const REQUIRED_SECTIONS = [
	"Chosen Thing",
	"Users and Context",
	"Goals",
	"Non-Goals",
	"Constraints",
	"Success Criteria",
	"Candidate Shapes",
	"Chosen Shape",
	"Key Decisions",
	"Open Questions",
	"Next Step",
] as const;

export interface ShapeDocumentInfo {
	path: string;
	relativePath: string;
	content: string;
	topic?: string;
	date?: string;
	title?: string;
	openQuestions: string[];
	resolvedQuestions: string[];
	missingSections: string[];
	missingFrontmatter: string[];
	valid: boolean;
	mtimeMs: number;
}

export interface ThinkingMemoInfo {
	path: string;
	relativePath: string;
	topic?: string;
	date?: string;
	title?: string;
	mtimeMs: number;
	relevance: number;
}

export function isSafeShapeCommand(command: string): boolean {
	const normalized = command.trim();
	if (/^\s*git\s+clone\s+--depth\s+1\s+\S+\s+\/tmp\//i.test(normalized)) {
		return true;
	}

	const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(normalized));
	const isSafe = SAFE_PATTERNS.some((pattern) => pattern.test(normalized));
	return !isDestructive && isSafe;
}

function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return {};

	const result: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
		if (kv) result[kv[1].trim()] = kv[2].trim();
	}
	return result;
}

function extractHeadingSection(content: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = content.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, "im"));
	return match?.[1]?.trim() ?? "";
}

function extractBullets(section: string): string[] {
	if (!section) return [];
	const items = section
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /^[-*]\s+/.test(line))
		.map((line) => line.replace(/^[-*]\s+/, "").trim())
		.filter(Boolean);
	return items;
}

function isNoneValue(value: string): boolean {
	return /^(none|none currently|n\/a|no open questions)\.?$/i.test(value.trim());
}

function normalizeWords(value?: string): string[] {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3);
}

function scoreThinkingMemo(topicHint: string | undefined, memo: Omit<ThinkingMemoInfo, "relevance">): number {
	if (!topicHint?.trim()) return memo.mtimeMs;

	const hintWords = new Set(normalizeWords(topicHint));
	const memoWords = new Set(normalizeWords([memo.topic, memo.title, memo.relativePath].filter(Boolean).join(" ")));
	let overlap = 0;
	for (const word of hintWords) {
		if (memoWords.has(word)) overlap += 1;
	}

	return overlap * 1_000_000_000_000 + memo.mtimeMs;
}

export function validateShapeContent(path: string, relativePath: string, content: string, mtimeMs = 0): ShapeDocumentInfo {
	const frontmatter = parseFrontmatter(content);
	const missingFrontmatter = ["date", "topic"].filter((key) => !frontmatter[key]);
	const missingSections = REQUIRED_SECTIONS.filter((section) => !new RegExp(`^##\\s+${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im").test(content));

	const openQuestionSection = extractHeadingSection(content, "Open Questions");
	const resolvedQuestionSection = extractHeadingSection(content, "Resolved Questions");
	let openQuestions = extractBullets(openQuestionSection);
	if (openQuestions.length === 1 && isNoneValue(openQuestions[0])) openQuestions = [];
	if (openQuestions.length === 0 && isNoneValue(openQuestionSection)) openQuestions = [];

	let resolvedQuestions = extractBullets(resolvedQuestionSection);
	if (resolvedQuestions.length === 1 && isNoneValue(resolvedQuestions[0])) resolvedQuestions = [];

	const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();

	return {
		path,
		relativePath,
		content,
		topic: frontmatter.topic,
		date: frontmatter.date,
		title,
		openQuestions,
		resolvedQuestions,
		missingSections: [...missingSections],
		missingFrontmatter,
		valid: missingFrontmatter.length === 0 && missingSections.length === 0,
		mtimeMs,
	};
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectMarkdownFiles(fullPath)));
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(fullPath);
		}
	}
	return files;
}

export async function findLatestShapeDocument(cwd: string, preferredRelativePath?: string): Promise<ShapeDocumentInfo | undefined> {
	const baseDir = resolve(cwd, "docs/briefs");
	let files: string[] = [];
	try {
		files = await collectMarkdownFiles(baseDir);
	} catch {
		return undefined;
	}

	if (files.length === 0) return undefined;

	const preferredPath = preferredRelativePath ? resolve(cwd, preferredRelativePath) : undefined;
	const candidates: ShapeDocumentInfo[] = [];
	for (const file of files) {
		try {
			const [content, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
			candidates.push(
				validateShapeContent(file, relative(cwd, file), content, fileStat.mtimeMs),
			);
		} catch {
			// ignore unreadable files
		}
	}

	if (candidates.length === 0) return undefined;
	candidates.sort((a, b) => {
		if (preferredPath) {
			if (resolve(cwd, a.relativePath) === preferredPath) return -1;
			if (resolve(cwd, b.relativePath) === preferredPath) return 1;
		}
		return b.mtimeMs - a.mtimeMs;
	});
	return candidates[0];
}

export async function findRelevantThinkingMemos(cwd: string, topicHint?: string, limit = 3): Promise<ThinkingMemoInfo[]> {
	const baseDir = resolve(cwd, "docs/thinking");
	let files: string[] = [];
	try {
		files = await collectMarkdownFiles(baseDir);
	} catch {
		return [];
	}

	if (files.length === 0) return [];

	const candidates: ThinkingMemoInfo[] = [];
	for (const file of files) {
		try {
			const [content, fileStat] = await Promise.all([readFile(file, "utf8"), stat(file)]);
			const frontmatter = parseFrontmatter(content);
			const relativePath = relative(cwd, file);
			const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
			const memoBase = {
				path: file,
				relativePath,
				topic: frontmatter.topic,
				date: frontmatter.date,
				title,
				mtimeMs: fileStat.mtimeMs,
			};
			candidates.push({
				...memoBase,
				relevance: scoreThinkingMemo(topicHint, memoBase),
			});
		} catch {
			// ignore unreadable files
		}
	}

	return candidates
		.sort((a, b) => b.relevance - a.relevance)
		.slice(0, limit);
}
