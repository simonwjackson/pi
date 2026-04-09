import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { searchBrave, searchSerper } from "./clients.js";
import {
	buildEffectiveQuery,
	clampNumResults,
	formatResults,
	normalizeBackend,
	rrfMerge,
	truncateOutput,
	type Backend,
} from "./core.js";

const WebSearchParams = Type.Object({
	query: Type.String({ description: "Search query" }),
	backend: Type.Optional(
		Type.String({
			description: "Backend to use: brave, serper, or all (default: all)",
		}),
	),
	numResults: Type.Optional(Type.Number({ description: "Number of results to return (default: 10, max: 20)" })),
	includeText: Type.Optional(
		Type.Boolean({
			description: "Include full page text (accepted for compatibility, not implemented yet)",
		}),
	),
});

type WebSearchParamsType = {
	query: string;
	backend?: string;
	numResults?: number;
	includeText?: boolean;
};

function keyState(value: string | undefined): string {
	return value ? "set" : "not set";
}

function requestedBackends(backend: Backend): Array<"brave" | "serper"> {
	if (backend === "all") return ["brave", "serper"];
	return [backend];
}

export default function webSearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description:
			"Search the web via Brave Search and Serper.dev (Google SERP) with Reciprocal Rank Fusion (RRF). Use for current events, docs lookups, and time-sensitive information.",
		promptSnippet:
			"Search the web with Brave + Serper, fuse rankings with RRF, and return concise sourced results.",
		promptGuidelines: [
			"Use this tool when the user asks for current events, latest versions, recent changes, or live web information.",
			"Prefer backend=all unless the user explicitly requests a specific backend.",
		],
		parameters: WebSearchParams,

		async execute(_toolCallId, params: WebSearchParamsType, signal) {
			const query = params.query?.trim();
			if (!query) {
				return {
					content: [{ type: "text" as const, text: "Error: query is required" }],
					details: { ok: false },
					isError: true,
				};
			}

			let backend: Backend;
			try {
				backend = normalizeBackend(params.backend);
			} catch (error) {
				return {
					content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
					details: { ok: false },
					isError: true,
				};
			}

			const numResults = clampNumResults(params.numResults);
			const includeText = params.includeText === true;
			const { intent, effectiveQuery } = buildEffectiveQuery(query);

			const braveKey = process.env.BRAVE_API_KEY;
			const serperKey = process.env.SERPER_API_KEY;

			const requested = requestedBackends(backend);
			const available = requested.filter((source) => {
				if (source === "brave") return Boolean(braveKey);
				return Boolean(serperKey);
			});

			if (available.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								"Error: no configured backends available for this request.\n\n" +
								`Requested backend: ${backend}\n` +
								`BRAVE_API_KEY: ${keyState(braveKey)}\n` +
								`SERPER_API_KEY: ${keyState(serperKey)}\n\n` +
								"Set at least one key:\n" +
								"- BRAVE_API_KEY from https://brave.com/search/api/\n" +
								"- SERPER_API_KEY from https://serper.dev/",
						},
					],
					details: { ok: false, backend, requested, available },
					isError: true,
				};
			}

			const [braveResults, serperResults] = await Promise.all([
				available.includes("brave") && braveKey
					? searchBrave(effectiveQuery, numResults, braveKey, signal)
					: Promise.resolve([]),
				available.includes("serper") && serperKey
					? searchSerper(effectiveQuery, numResults, serperKey, signal)
					: Promise.resolve([]),
			]);

			const combined = [...braveResults, ...serperResults];
			if (combined.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text:
								"Search returned no results from configured backends.\n" +
								"Try a broader query, or switch backend with backend=brave|serper.",
						},
					],
					details: {
						ok: false,
						backend,
						requested,
						available,
						braveCount: braveResults.length,
						serperCount: serperResults.length,
					},
					isError: true,
				};
			}

			const merged = rrfMerge(combined, numResults);
			const lines: string[] = [
				`# Web Search Results`,
				`- Query: ${query}`,
				`- Intent: ${intent}`,
				`- Backend requested: ${backend}`,
				`- Backends used: ${available.join(", ")}`,
				`- Raw results: brave=${braveResults.length}, serper=${serperResults.length}`,
				`- Fused results: ${merged.length}`,
			];

			if (intent === "code") {
				lines.push(`- Effective query: ${effectiveQuery}`);
			}
			if (includeText) {
				lines.push("- Note: includeText requested, but full-page extraction is not implemented yet.");
			}

			const body = `${lines.join("\n")}\n\n${formatResults(merged)}`;
			const truncated = truncateOutput(body);

			return {
				content: [{ type: "text" as const, text: truncated.text }],
				details: {
					ok: true,
					intent,
					backend,
					backendsUsed: available,
					query,
					effectiveQuery,
					braveCount: braveResults.length,
					serperCount: serperResults.length,
					fusedCount: merged.length,
					truncated: truncated.truncated,
				},
			};
		},

		renderCall(args: WebSearchParamsType, theme) {
			const backend = args.backend ?? "all";
			const text =
				theme.fg("toolTitle", theme.bold("web_search ")) +
				theme.fg("accent", backend) +
				" " +
				theme.fg("muted", args.query ?? "");
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const text = result.content.find((part) => part.type === "text");
			if (!text || text.type !== "text") return new Text("", 0, 0);
			const color = result.isError ? "error" : "success";
			const firstLine = text.text.split("\n")[0] ?? "";
			return new Text(theme.fg(color, firstLine), 0, 0);
		},
	});
}
