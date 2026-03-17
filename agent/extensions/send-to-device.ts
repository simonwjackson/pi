import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { open, readdir, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";

const DEFAULT_TARGET = "simons-z-fold7";
const MAX_INFERRED_FILES = 200;
const SEND_TIMEOUT_MS = 120_000;

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	".pi",
	".direnv",
	".loop-worktrees",
	".worktrees",
	".next",
	"dist",
	"build",
]);

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".mdx",
	".markdown",
	".rst",
	".adoc",
	".json",
	".jsonc",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".conf",
	".env",
	".xml",
	".csv",
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".rb",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
	".c",
	".cc",
	".cpp",
	".h",
	".hpp",
	".cs",
	".sh",
	".zsh",
	".bash",
	".fish",
	".sql",
	".graphql",
	".gql",
	".css",
	".scss",
	".sass",
	".less",
	".html",
	".htm",
	".svg",
]);

const SendToDeviceParams = Type.Object({
	files: Type.Optional(
		Type.Array(
			Type.String({
				description: "Explicit file paths to send. If omitted, infer text files modified in the previous turn.",
			}),
		),
	),
	target: Type.Optional(
		Type.String({
			description: `Target Tailscale device (default: ${DEFAULT_TARGET})`,
		}),
	),
	includeNonText: Type.Optional(
		Type.Boolean({
			description: "Include non-text files. Defaults to false.",
		}),
	),
});

type SendToDeviceParamsType = {
	files?: string[];
	target?: string;
	includeNonText?: boolean;
};

type TimeWindow = {
	startMs: number;
	endMs: number;
};

type FileRecord = {
	path: string;
	size: number;
};

type SendFailure = {
	path: string;
	error: string;
};

type SendResultDetails = {
	target: string;
	source: "explicit" | "inferred";
	sent: FileRecord[];
	missing: string[];
	skippedNonText: Array<FileRecord | string>;
	failures: SendFailure[];
};

type ExecuteSendResult = {
	content: Array<{ type: "text"; text: string }>;
	details: SendResultDetails;
	isError: boolean;
};

function normalizePathArg(path: string): string {
	const trimmed = path.trim();
	if (!trimmed) return "";
	return trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
}

function dedupeStrings(values: string[]): string[] {
	return [...new Set(values)];
}

function toDisplayPath(cwd: string, absolutePath: string): string {
	const rel = relative(cwd, absolutePath);
	if (!rel || rel.startsWith("..")) return absolutePath;
	return rel;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function normalizeTimestampToMs(value: unknown): number | null {
	let timestamp: number | null = null;

	if (typeof value === "number") {
		timestamp = value;
	} else if (typeof value === "string") {
		const numeric = Number(value);
		if (Number.isFinite(numeric)) {
			timestamp = numeric;
		} else {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) {
				timestamp = parsed;
			}
		}
	}

	if (timestamp === null || !Number.isFinite(timestamp)) return null;
	if (timestamp <= 0) return null;

	// Session timestamps may be in seconds; file mtimes are in milliseconds.
	if (timestamp < 1_000_000_000_000) {
		return Math.trunc(timestamp * 1000);
	}

	return Math.trunc(timestamp);
}

function getPreviousTurnWindow(ctx: any): TimeWindow | null {
	const entries = ctx.sessionManager.getBranch() as Array<any>;
	const userTimestamps = entries
		.filter((entry) => entry?.type === "message" && entry.message?.role === "user")
		.map((entry) => normalizeTimestampToMs(entry.message?.timestamp))
		.filter((timestamp): timestamp is number => Number.isFinite(timestamp))
		.sort((a, b) => a - b);

	if (userTimestamps.length < 2) {
		return null;
	}

	return {
		startMs: userTimestamps[userTimestamps.length - 2],
		endMs: userTimestamps[userTimestamps.length - 1],
	};
}

async function collectModifiedFiles(rootDir: string, window: TimeWindow, limit: number): Promise<string[]> {
	const results: string[] = [];
	const stack: string[] = [rootDir];

	while (stack.length > 0 && results.length < limit) {
		const dir = stack.pop();
		if (!dir) break;

		let entries: Awaited<ReturnType<typeof readdir>>;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			if (results.length >= limit) break;

			const fullPath = resolve(dir, entry.name);

			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				stack.push(fullPath);
				continue;
			}

			if (!entry.isFile()) continue;

			let info: Awaited<ReturnType<typeof stat>>;
			try {
				info = await stat(fullPath);
			} catch {
				continue;
			}

			if (info.mtimeMs >= window.startMs && info.mtimeMs <= window.endMs) {
				results.push(fullPath);
			}
		}
	}

	return results;
}

function looksLikeTextByExtension(path: string): boolean {
	const ext = extname(path).toLowerCase();
	return TEXT_EXTENSIONS.has(ext);
}

async function looksLikeTextByContent(path: string): Promise<boolean> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(path, "r");
		const buffer = Buffer.alloc(4096);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		for (let i = 0; i < bytesRead; i += 1) {
			if (buffer[i] === 0) return false;
		}
		return true;
	} catch {
		return false;
	} finally {
		if (handle) {
			await handle.close();
		}
	}
}

async function isTextDocument(path: string): Promise<boolean> {
	if (looksLikeTextByExtension(path)) return true;
	return looksLikeTextByContent(path);
}

function parseSendCommandArgs(args: string): SendToDeviceParamsType {
	const tokens = args.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
	const files: string[] = [];
	let target: string | undefined;
	let includeNonText = false;

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		const unquoted = token.replace(/^['"]|['"]$/g, "");

		if (unquoted === "--include-non-text") {
			includeNonText = true;
			continue;
		}

		if (unquoted === "--target") {
			const next = tokens[index + 1]?.replace(/^['"]|['"]$/g, "");
			if (next) {
				target = next;
				index += 1;
			}
			continue;
		}

		if (unquoted.startsWith("--target=")) {
			target = unquoted.slice("--target=".length);
			continue;
		}

		files.push(unquoted);
	}

	return {
		files: files.length > 0 ? files : undefined,
		target,
		includeNonText,
	};
}

async function executeSend(
	pi: ExtensionAPI,
	params: SendToDeviceParamsType,
	ctx: any,
	signal?: AbortSignal,
	onUpdate?: (update: { content: Array<{ type: "text"; text: string }> }) => void,
): Promise<ExecuteSendResult> {
	const target = params.target?.trim() ? params.target.trim() : DEFAULT_TARGET;
	const includeNonText = params.includeNonText === true;

	let absolutePaths = dedupeStrings(
		(params.files ?? [])
			.map((file) => normalizePathArg(file))
			.filter((file) => file.length > 0)
			.map((file) => resolve(ctx.cwd, file)),
	);

	let source: "explicit" | "inferred" = "explicit";
	if (absolutePaths.length === 0) {
		source = "inferred";
		const window = getPreviousTurnWindow(ctx);
		if (window) {
			absolutePaths = dedupeStrings(await collectModifiedFiles(ctx.cwd, window, MAX_INFERRED_FILES));
		}
	}

	if (absolutePaths.length === 0) {
		return {
			content: [{ type: "text", text: "No files selected to send." }],
			details: { target, source, sent: [], missing: [], skippedNonText: [], failures: [] },
			isError: true,
		};
	}

	const existing: FileRecord[] = [];
	const missing: string[] = [];

	for (const path of absolutePaths) {
		try {
			const info = await stat(path);
			if (!info.isFile()) {
				missing.push(path);
				continue;
			}
			existing.push({ path, size: info.size });
		} catch {
			missing.push(path);
		}
	}

	const sendable: FileRecord[] = [];
	const skippedNonText: FileRecord[] = [];

	for (const file of existing) {
		if (includeNonText || (await isTextDocument(file.path))) {
			sendable.push(file);
		} else {
			skippedNonText.push(file);
		}
	}

	if (sendable.length === 0) {
		const lines = ["No sendable text documents found."];
		if (missing.length > 0) {
			lines.push(`Missing: ${missing.map((path) => toDisplayPath(ctx.cwd, path)).join(", ")}`);
		}
		if (skippedNonText.length > 0) {
			lines.push(`Skipped non-text: ${skippedNonText.map((file) => toDisplayPath(ctx.cwd, file.path)).join(", ")}`);
		}
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: {
				target,
				source,
				sent: [],
				missing,
				skippedNonText,
				failures: [],
			},
			isError: true,
		};
	}

	const sent: FileRecord[] = [];
	const failures: SendFailure[] = [];

	for (const [index, file] of sendable.entries()) {
		onUpdate?.({
			content: [{ type: "text", text: `Sending ${index + 1}/${sendable.length}: ${toDisplayPath(ctx.cwd, file.path)}` }],
		});

		const copyCommand = `sudo tailscale file cp ${shellQuote(file.path)} ${shellQuote(`${target}:`)}`;

		let result = await pi.exec("bash", ["-lc", `script -qefc ${shellQuote(copyCommand)} /dev/null`], {
			signal,
			timeout: SEND_TIMEOUT_MS,
		});

		if (result.code !== 0) {
			const stderr = result.stderr ?? "";
			if (result.code === 127 || /script: command not found/i.test(stderr)) {
				result = await pi.exec("sudo", ["tailscale", "file", "cp", file.path, `${target}:`], {
					signal,
					timeout: SEND_TIMEOUT_MS,
				});
			}
		}

		if (result.code === 0) {
			sent.push(file);
			continue;
		}

		const stderr = result.stderr?.trim();
		const stdout = result.stdout?.trim();
		failures.push({
			path: file.path,
			error: stderr || stdout || `Command failed with exit code ${result.code}`,
		});
	}

	const lines: string[] = [`Target: ${target}`];
	for (const file of sent) {
		lines.push(`- ${toDisplayPath(ctx.cwd, file.path)} (${file.size} bytes)`);
	}

	if (missing.length > 0) {
		lines.push(`Missing: ${missing.map((path) => toDisplayPath(ctx.cwd, path)).join(", ")}`);
	}

	if (skippedNonText.length > 0) {
		lines.push(`Skipped non-text: ${skippedNonText.map((file) => toDisplayPath(ctx.cwd, file.path)).join(", ")}`);
	}

	if (failures.length > 0) {
		lines.push("Failures:");
		for (const failure of failures) {
			lines.push(`- ${toDisplayPath(ctx.cwd, failure.path)}: ${failure.error}`);
		}
	}

	const summary = sent.length > 0 ? `Sent ${sent.length} file${sent.length === 1 ? "" : "s"} to ${target}.` : `No files sent to ${target}.`;

	return {
		content: [{ type: "text", text: `${summary}\n${lines.join("\n")}` }],
		details: {
			target,
			source,
			sent,
			missing,
			skippedNonText,
			failures,
		},
		isError: failures.length > 0 || sent.length === 0,
	};
}

export default function sendToDeviceExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "send_to_device",
		label: "Send to Device",
		description:
			"Send files to a Tailscale device. Defaults to text files created/modified in the previous turn and target simons-z-fold7.",
		promptSnippet: "Send files to a Tailscale device, defaulting to previous-turn text docs and simons-z-fold7.",
		promptGuidelines: [
			"Use this tool when the user asks to send files to a phone/device over Tailscale.",
			`Default target is ${DEFAULT_TARGET} unless user provides another device.`,
			"If no files are provided, infer text documents modified in the immediately previous turn.",
			"Only include non-text files when the user explicitly asks for them.",
		],
		parameters: SendToDeviceParams,

		async execute(_toolCallId, params: SendToDeviceParamsType, signal, onUpdate, ctx) {
			return executeSend(pi, params, ctx, signal, onUpdate);
		},

		renderCall(args: SendToDeviceParamsType, theme) {
			const target = args.target?.trim() ? args.target.trim() : DEFAULT_TARGET;
			const files = args.files?.length ?? 0;
			const mode = files > 0 ? `${files} explicit` : "inferred from previous turn";
			const text =
				theme.fg("toolTitle", theme.bold("send_to_device ")) +
				theme.fg("accent", target) +
				" " +
				theme.fg("muted", `(${mode})`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as SendResultDetails | undefined;
			if (!details) {
				const text = result.content.find((part) => part.type === "text");
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			const sentCount = details.sent?.length ?? 0;
			const failureCount = details.failures?.length ?? 0;
			const target = details.target ?? DEFAULT_TARGET;
			const color = failureCount > 0 || sentCount === 0 ? "warning" : "success";
			return new Text(theme.fg(color, `target=${target} sent=${sentCount} failed=${failureCount}`), 0, 0);
		},
	});

	pi.registerCommand("send", {
		description: "Send files to a Tailscale device using the send_to_device tool logic",
		handler: async (args, ctx) => {
			const params = parseSendCommandArgs(args ?? "");
			ctx.ui.setStatus("send", `Sending to ${params.target ?? DEFAULT_TARGET}...`);
			try {
				const result = await executeSend(pi, params, ctx, undefined, (update) => {
					const text = update.content[0]?.text;
					if (text) ctx.ui.setStatus("send", text);
				});

				const message = result.content[0]?.text ?? "Done";
				ctx.ui.notify(message, result.isError ? "warning" : "info");
			} finally {
				ctx.ui.setStatus("send", undefined);
			}
		},
	});
}
