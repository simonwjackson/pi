export type Backend = "all" | "brave" | "serper";
export type SearchIntent = "general" | "code";
export type SearchSource = "brave" | "serper";

export interface NormalizedResult {
	id: string;
	title: string;
	snippet: string;
	rank: number;
	source: SearchSource;
}

export interface MergedResult {
	id: string;
	title: string;
	snippet: string;
	sources: SearchSource[];
	rrfScore: number;
}

const CODE_QUERY_HINTS: RegExp[] = [
	/\bapi\b/i,
	/\bsdk\b/i,
	/\bdocs?\b/i,
	/\bdocumentation\b/i,
	/\btypescript\b/i,
	/\bjavascript\b/i,
	/\bpython\b/i,
	/\brust\b/i,
	/\breact\b/i,
	/\bnext\.?js\b/i,
	/\bnode\b/i,
	/\bstack\s*trace\b/i,
	/\berror\b/i,
	/\bexception\b/i,
	/\bbug\b/i,
	/\bgithub\b/i,
	/\bstackoverflow\b/i,
	/\bhow\s+do\s+i\b/i,
	/\bcode\b/i,
	/\bsnippet\b/i,
];

export const CODE_SITE_BIAS =
	"site:github.com OR site:stackoverflow.com OR site:developer.mozilla.org OR site:docs.python.org OR site:docs.rs";

export function normalizeBackend(input?: string): Backend {
	if (!input) return "all";
	if (input === "all" || input === "brave" || input === "serper") return input;
	throw new Error(`Invalid backend: ${input}. Use: brave, serper, or all`);
}

export function clampNumResults(input?: number): number {
	if (!Number.isFinite(input)) return 10;
	const safe = Math.floor(input as number);
	if (safe < 1) return 1;
	if (safe > 20) return 20;
	return safe;
}

export function detectSearchIntent(query: string): SearchIntent {
	return CODE_QUERY_HINTS.some((pattern) => pattern.test(query)) ? "code" : "general";
}

export function buildEffectiveQuery(query: string): { intent: SearchIntent; effectiveQuery: string } {
	const intent = detectSearchIntent(query);
	if (intent === "code") {
		return {
			intent,
			effectiveQuery: `${query} ${CODE_SITE_BIAS}`,
		};
	}
	return { intent, effectiveQuery: query };
}

export function normalizeResultId(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return raw;
	try {
		const url = new URL(trimmed);
		url.hash = "";
		if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
			url.pathname = url.pathname.slice(0, -1);
		}
		return url.toString();
	} catch {
		return trimmed;
	}
}

export function rrfMerge(results: NormalizedResult[], topN: number, k = 60): MergedResult[] {
	const grouped = new Map<string, NormalizedResult[]>();
	for (const result of results) {
		const id = normalizeResultId(result.id);
		const existing = grouped.get(id) ?? [];
		existing.push({ ...result, id });
		grouped.set(id, existing);
	}

	const merged: MergedResult[] = [];
	for (const [id, items] of grouped) {
		const best = [...items].sort((a, b) => a.rank - b.rank)[0];
		const sources = [...new Set(items.map((item) => item.source))].sort() as SearchSource[];
		const rrfScore = items.reduce((sum, item) => sum + 1 / (k + item.rank), 0);
		merged.push({
			id,
			title: best.title || "Untitled",
			snippet: best.snippet || "No description available",
			sources,
			rrfScore,
		});
	}

	return merged
		.sort((a, b) => {
			if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
			return a.id.localeCompare(b.id);
		})
		.slice(0, topN);
}

function truncateValue(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function formatResults(results: MergedResult[]): string {
	if (results.length === 0) return "";

	return results
		.map((result, index) => {
			const title = truncateValue(result.title || "Untitled", 180);
			const snippet = truncateValue(result.snippet || "No description available", 400);
			return [
				`## ${index + 1}. ${title}`,
				`- URL: ${result.id}`,
				`- Score: ${result.rrfScore.toFixed(4)}`,
				`- Sources: ${result.sources.join(", ")}`,
				`> ${snippet}`,
			].join("\n");
		})
		.join("\n\n");
}

export function truncateOutput(text: string, maxBytes = 45 * 1024, maxLines = 1200): { text: string; truncated: boolean } {
	const lines = text.split("\n");
	let currentBytes = 0;
	const kept: string[] = [];

	for (const line of lines) {
		const lineBytes = Buffer.byteLength(`${line}\n`, "utf8");
		if (kept.length + 1 > maxLines || currentBytes + lineBytes > maxBytes) {
			const summary = `\n\n[output truncated to ${maxLines} lines / ${(maxBytes / 1024).toFixed(0)}KB]`;
			return { text: `${kept.join("\n")}${summary}`, truncated: true };
		}
		kept.push(line);
		currentBytes += lineBytes;
	}

	return { text, truncated: false };
}
