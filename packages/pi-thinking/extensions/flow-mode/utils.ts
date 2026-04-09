import { extractTodoItems } from "../spec-mode/utils.js";

export type FlowStage = "idle" | "think" | "shape" | "spec" | "complete";

export interface FlowModeState {
	active: boolean;
	stage: FlowStage;
	topic?: string;
	memoPath?: string;
	briefPath?: string;
	thinkReady: boolean;
	shapeReady: boolean;
	specReady: boolean;
	updatedAt?: string;
}

export interface ThinkStateSnapshot {
	topic?: string;
	activeProblem?: string;
	memoPath?: string;
	readiness?: string;
}

export interface ShapeStateSnapshot {
	topic?: string;
	documentPath?: string;
	documentValid: boolean;
	openQuestions: string[];
}

export type FlowEntryMode = "explicit" | "current-context" | "prompt";

const INITIAL_STATE: FlowModeState = {
	active: false,
	stage: "idle",
	thinkReady: false,
	shapeReady: false,
	specReady: false,
};

export function createInitialFlowState(): FlowModeState {
	return {
		...INITIAL_STATE,
	};
}

export function isFlowStage(value: unknown): value is FlowStage {
	return value === "idle" || value === "think" || value === "shape" || value === "spec" || value === "complete";
}

export function isActiveStage(stage: FlowStage): boolean {
	return stage !== "idle" && stage !== "complete";
}

export function normalizeFlowState(data?: Partial<FlowModeState>): FlowModeState {
	const stage = isFlowStage(data?.stage) ? data.stage : "idle";
	return {
		...createInitialFlowState(),
		...data,
		stage,
		active: typeof data?.active === "boolean" ? data.active : isActiveStage(stage),
		thinkReady: data?.thinkReady === true,
		shapeReady: data?.shapeReady === true,
		specReady: data?.specReady === true,
	};
}

export function transitionFlowState(
	state: FlowModeState,
	stage: FlowStage,
	patch?: Partial<Omit<FlowModeState, "stage">>,
): FlowModeState {
	return normalizeFlowState({
		...state,
		...(patch ?? {}),
		stage,
	});
}

export function applyThinkStateToFlowState(state: FlowModeState, thinkState: ThinkStateSnapshot): FlowModeState {
	return normalizeFlowState({
		...state,
		topic: thinkState.activeProblem ?? thinkState.topic ?? state.topic,
		memoPath: thinkState.memoPath ?? state.memoPath,
		thinkReady: thinkState.readiness === "ready-to-synthesize",
	});
}

export function applyShapeStateToFlowState(state: FlowModeState, shapeState: ShapeStateSnapshot): FlowModeState {
	return normalizeFlowState({
		...state,
		topic: shapeState.topic ?? state.topic,
		briefPath: shapeState.documentPath ?? state.briefPath,
		shapeReady: shapeState.documentValid && shapeState.openQuestions.length === 0,
	});
}

export function applySpecTextToFlowState(state: FlowModeState, text: string): FlowModeState {
	if (extractTodoItems(text).length === 0) return normalizeFlowState(state);
	return normalizeFlowState({
		...state,
		specReady: true,
	});
}

export function applySpecTodosToFlowState(state: FlowModeState, todoCount: number): FlowModeState {
	if (todoCount <= 0) return normalizeFlowState(state);
	return normalizeFlowState({
		...state,
		specReady: true,
	});
}

export function resolveFlowEntryMode(input: string | undefined, hasCurrentSessionContext: boolean): FlowEntryMode {
	if (input?.trim()) return "explicit";
	return hasCurrentSessionContext ? "current-context" : "prompt";
}

export function buildSpecRequestInput(briefPath?: string, memoPath?: string): string {
	if (briefPath?.trim()) {
		return `Begin spec generation for the guided /flow pipeline from brief \`${briefPath}\`. Read that brief first and treat it as the primary input. ${memoPath ? `You may consult \`${memoPath}\` or other docs/thinking files only as optional rationale/history if helpful. ` : "You may consult docs/thinking/* only as optional rationale/history if helpful. "}Do not restate or synthesize the full conversation history when the current session context already contains it. Produce the result under a \`Spec:\` header followed by numbered steps.`;
	}

	return "Begin spec generation for the guided /flow pipeline from the current session context. First check docs/briefs/ and treat any relevant brief as the primary input. Use docs/thinking/ only as optional rationale/history. Do not restate or synthesize the full conversation history when the current session context already contains it. Produce the result under a `Spec:` header followed by numbered steps.";
}

export function shouldSuspendFlowForExternalModality(options: {
	active: boolean;
	eventId?: string;
	currentModalityId?: string;
	expectedModalityId?: string;
}): boolean {
	if (!options.active) return false;
	if (!options.eventId) return false;
	if (options.expectedModalityId && options.eventId === options.expectedModalityId) return false;
	if (options.currentModalityId && options.eventId === options.currentModalityId) return false;
	return true;
}
