import { describe, expect, test } from "bun:test";
import {
	buildEffectiveQuery,
	clampNumResults,
	formatResults,
	normalizeBackend,
	normalizeResultId,
	rrfMerge,
	truncateOutput,
	type NormalizedResult,
} from "./core.js";

describe("normalizeBackend", () => {
	test("defaults to all", () => {
		expect(normalizeBackend(undefined)).toBe("all");
	});

	test("accepts explicit backend", () => {
		expect(normalizeBackend("brave")).toBe("brave");
		expect(normalizeBackend("serper")).toBe("serper");
		expect(normalizeBackend("all")).toBe("all");
	});

	test("rejects invalid values", () => {
		expect(() => normalizeBackend("google")).toThrow("Invalid backend");
	});
});

describe("query handling", () => {
	test("clamps result count", () => {
		expect(clampNumResults(undefined)).toBe(10);
		expect(clampNumResults(0)).toBe(1);
		expect(clampNumResults(3.9)).toBe(3);
		expect(clampNumResults(200)).toBe(20);
	});

	test("detects code intent and applies site bias", () => {
		const result = buildEffectiveQuery("react use hook docs");
		expect(result.intent).toBe("code");
		expect(result.effectiveQuery).toContain("site:github.com");
	});

	test("keeps general query unchanged", () => {
		const result = buildEffectiveQuery("latest economic outlook 2026");
		expect(result.intent).toBe("general");
		expect(result.effectiveQuery).toBe("latest economic outlook 2026");
	});
});

describe("rrfMerge", () => {
	const seed: NormalizedResult[] = [
		{ id: "https://example.com/a", title: "A brave", snippet: "A", rank: 1, source: "brave" },
		{ id: "https://example.com/b", title: "B brave", snippet: "B", rank: 2, source: "brave" },
		{ id: "https://example.com/a/", title: "A serper", snippet: "A2", rank: 3, source: "serper" },
		{ id: "https://example.com/c", title: "C serper", snippet: "C", rank: 1, source: "serper" },
	];

	test("deduplicates and fuses by canonical URL", () => {
		const merged = rrfMerge(seed, 10, 60);
		expect(merged.length).toBe(3);
		const docA = merged.find((item) => item.id === "https://example.com/a");
		expect(docA?.sources.sort()).toEqual(["brave", "serper"]);
	});

	test("sorts by descending score", () => {
		const merged = rrfMerge(seed, 2, 60);
		expect(merged.length).toBe(2);
		expect(merged[0].rrfScore).toBeGreaterThanOrEqual(merged[1].rrfScore);
	});
});

describe("formatting and truncation", () => {
	test("normalizes URL ids", () => {
		expect(normalizeResultId("https://example.com/path/#hash")).toBe("https://example.com/path");
		expect(normalizeResultId("https://example.com/path/")).toBe("https://example.com/path");
	});

	test("formats merged results", () => {
		const text = formatResults([
			{
				id: "https://example.com/a",
				title: "Example title",
				snippet: "Example snippet",
				sources: ["brave"],
				rrfScore: 0.1234,
			},
		]);
		expect(text).toContain("## 1. Example title");
		expect(text).toContain("URL: https://example.com/a");
		expect(text).toContain("Sources: brave");
	});

	test("truncates output when byte/line limits are exceeded", () => {
		const source = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
		const result = truncateOutput(source, 120, 8);
		expect(result.truncated).toBeTrue();
		expect(result.text).toContain("[output truncated");
	});
});
