import { describe, expect, test } from "bun:test";
import {
	applyShapeStateToFlowState,
	applySpecTextToFlowState,
	applyThinkStateToFlowState,
	buildSpecRequestInput,
	createInitialFlowState,
	normalizeFlowState,
	resolveFlowEntryMode,
	shouldSuspendFlowForExternalModality,
	transitionFlowState,
} from "./utils.js";

describe("flow-mode validation helpers", () => {
	test("preserves persisted stage state across normalize/restore-style usage", () => {
		const restored = normalizeFlowState({
			active: false,
			stage: "shape",
			topic: "saved views",
			briefPath: "docs/briefs/2026-03-28-saved-views-brief.md",
			shapeReady: true,
		});

		expect(restored.stage).toBe("shape");
		expect(restored.active).toBeFalse();
		expect(restored.briefPath).toBe("docs/briefs/2026-03-28-saved-views-brief.md");
		expect(restored.shapeReady).toBeTrue();
	});

	test("resolves /flow entry behavior for explicit input and current-session context", () => {
		expect(resolveFlowEntryMode("Add saved views", true)).toBe("explicit");
		expect(resolveFlowEntryMode(undefined, true)).toBe("current-context");
		expect(resolveFlowEntryMode(undefined, false)).toBe("prompt");
	});

	test("records think readiness and memo path from think-mode signals", () => {
		const next = applyThinkStateToFlowState(createInitialFlowState(), {
			activeProblem: "saved views",
			memoPath: "docs/thinking/2026-03-28-saved-views-think.md",
			readiness: "ready-to-synthesize",
		});

		expect(next.topic).toBe("saved views");
		expect(next.memoPath).toBe("docs/thinking/2026-03-28-saved-views-think.md");
		expect(next.thinkReady).toBeTrue();
	});

	test("marks shape ready only when brief is valid and open questions are resolved", () => {
		const withOpenQuestions = applyShapeStateToFlowState(createInitialFlowState(), {
			topic: "saved views",
			documentPath: "docs/briefs/2026-03-28-saved-views-brief.md",
			documentValid: true,
			openQuestions: ["Should saved views be shareable?"],
		});
		expect(withOpenQuestions.briefPath).toBe("docs/briefs/2026-03-28-saved-views-brief.md");
		expect(withOpenQuestions.shapeReady).toBeFalse();

		const ready = applyShapeStateToFlowState(createInitialFlowState(), {
			topic: "saved views",
			documentPath: "docs/briefs/2026-03-28-saved-views-brief.md",
			documentValid: true,
			openQuestions: [],
		});
		expect(ready.shapeReady).toBeTrue();
	});

	test("completed spec still requires a valid Spec header with numbered tasks", () => {
		const invalid = applySpecTextToFlowState(createInitialFlowState(), "Here is a plan without the required header\n1. Step one");
		expect(invalid.specReady).toBeFalse();

		const valid = applySpecTextToFlowState(
			createInitialFlowState(),
			"Spec:\n1. Add flow-mode validation helpers\n2. Add tests for flow transitions",
		);
		expect(valid.specReady).toBeTrue();
	});

	test("spec kickoff prompt prioritizes briefs and keeps thinking memos optional", () => {
		const withBrief = buildSpecRequestInput(
			"docs/briefs/2026-03-28-saved-views-brief.md",
			"docs/thinking/2026-03-28-saved-views-think.md",
		);
		expect(withBrief).toContain("docs/briefs/2026-03-28-saved-views-brief.md");
		expect(withBrief).toContain("primary input");
		expect(withBrief).toContain("optional rationale/history");
		expect(withBrief).toContain("Do not restate or synthesize the full conversation history");

		const withoutBrief = buildSpecRequestInput(undefined, undefined);
		expect(withoutBrief).toContain("First check docs/briefs/");
		expect(withoutBrief).toContain("Use docs/thinking/");
	});

	test("manual modality interruption leaves flow recoverable", () => {
		expect(
			shouldSuspendFlowForExternalModality({
				active: true,
				eventId: "shape-mode",
				currentModalityId: "think-mode",
				expectedModalityId: undefined,
			}),
		).toBeTrue();

		expect(
			shouldSuspendFlowForExternalModality({
				active: true,
				eventId: "shape-mode",
				currentModalityId: "shape-mode",
				expectedModalityId: undefined,
			}),
		).toBeFalse();

		expect(
			shouldSuspendFlowForExternalModality({
				active: true,
				eventId: "shape-mode",
				currentModalityId: "think-mode",
				expectedModalityId: "shape-mode",
			}),
		).toBeFalse();
	});

	test("transition helper preserves recoverable state between stages", () => {
		const started = transitionFlowState(createInitialFlowState(), "think", {
			active: true,
			topic: "saved views",
		});
		const transitioned = transitionFlowState(started, "shape", {
			briefPath: "docs/briefs/2026-03-28-saved-views-brief.md",
		});

		expect(transitioned.stage).toBe("shape");
		expect(transitioned.topic).toBe("saved views");
		expect(transitioned.briefPath).toBe("docs/briefs/2026-03-28-saved-views-brief.md");
	});
});
