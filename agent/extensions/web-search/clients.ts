import { normalizeResultId, type NormalizedResult } from "./core.js";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const SERPER_API_URL = "https://google.serper.dev/search";

type BraveResult = { url?: string; title?: string; description?: string };
type BraveResponse = { web?: { results?: BraveResult[] }; error?: string };

type SerperResult = { link?: string; title?: string; snippet?: string };
type SerperResponse = { organic?: SerperResult[]; error?: string };

function createMergedSignal(parentSignal?: AbortSignal, timeoutMs = 15_000): { signal: AbortSignal; cleanup: () => void } {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);

	const onAbort = () => controller.abort(parentSignal?.reason);
	if (parentSignal) {
		if (parentSignal.aborted) {
			onAbort();
		} else {
			parentSignal.addEventListener("abort", onAbort, { once: true });
		}
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			clearTimeout(timer);
			if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
		},
	};
}

export async function searchBrave(
	query: string,
	numResults: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<NormalizedResult[]> {
	const { signal: mergedSignal, cleanup } = createMergedSignal(signal);
	try {
		const url = new URL(BRAVE_API_URL);
		url.searchParams.set("q", query);
		url.searchParams.set("count", String(numResults));

		const response = await fetch(url, {
			headers: {
				Accept: "application/json",
				"X-Subscription-Token": apiKey,
			},
			signal: mergedSignal,
		});

		if (!response.ok) return [];
		const data = (await response.json()) as BraveResponse;
		if (data.error) return [];

		return (data.web?.results ?? [])
			.filter((result): result is Required<Pick<BraveResult, "url">> & BraveResult => typeof result.url === "string")
			.map((result, index) => ({
				id: normalizeResultId(result.url),
				title: result.title ?? "Untitled",
				snippet: result.description ?? "",
				rank: index + 1,
				source: "brave" as const,
			}));
	} catch {
		return [];
	} finally {
		cleanup();
	}
}

export async function searchSerper(
	query: string,
	numResults: number,
	apiKey: string,
	signal?: AbortSignal,
): Promise<NormalizedResult[]> {
	const { signal: mergedSignal, cleanup } = createMergedSignal(signal);
	try {
		const response = await fetch(SERPER_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-API-KEY": apiKey,
			},
			body: JSON.stringify({ q: query, num: numResults }),
			signal: mergedSignal,
		});

		if (!response.ok) return [];
		const data = (await response.json()) as SerperResponse;
		if (data.error) return [];

		return (data.organic ?? [])
			.filter((result): result is Required<Pick<SerperResult, "link">> & SerperResult => typeof result.link === "string")
			.map((result, index) => ({
				id: normalizeResultId(result.link),
				title: result.title ?? "Untitled",
				snippet: result.snippet ?? "",
				rank: index + 1,
				source: "serper" as const,
			}));
	} catch {
		return [];
	} finally {
		cleanup();
	}
}
