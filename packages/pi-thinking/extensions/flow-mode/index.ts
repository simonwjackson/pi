import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getShapeModeController } from "../shape-mode/index.js";
import { getSpecModeController } from "../spec-mode/index.js";
import { getThinkModeController } from "../think-mode/index.js";
import {
	applyShapeStateToFlowState,
	applySpecTextToFlowState,
	applySpecTodosToFlowState,
	applyThinkStateToFlowState,
	buildSpecRequestInput,
	createInitialFlowState,
	isActiveStage,
	normalizeFlowState,
	resolveFlowEntryMode,
	shouldSuspendFlowForExternalModality,
	transitionFlowState,
	type FlowModeState,
	type FlowStage,
} from "./utils.js";

export type { FlowModeState, FlowStage } from "./utils.js";

const FLOW_ENTRY_TYPE = "flow-mode";
const EXCLUSIVE_MODALITY_EVENT = "modality:activated";
const THINK_MODALITY_ID = "think-mode";
const SHAPE_MODALITY_ID = "shape-mode";
const SPEC_MODALITY_ID = "spec-mode";

function getMessageText(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getStageLabel(stage: FlowStage): string {
	switch (stage) {
		case "think":
			return "think";
		case "shape":
			return "shape";
		case "spec":
			return "spec";
		case "complete":
			return "complete";
		default:
			return "idle";
	}
}

function formatFlowSummary(state: FlowModeState): string {
	const status = state.stage === "complete" ? "status=complete" : state.active ? "status=active" : state.stage === "idle" ? "status=idle" : "status=paused";
	const parts = [status, `stage=${state.stage}`];
	if (state.topic) parts.push(`topic=${state.topic}`);
	if (state.memoPath) parts.push(`memo=${state.memoPath}`);
	if (state.briefPath) parts.push(`brief=${state.briefPath}`);
	if (state.thinkReady) parts.push("thinkReady=true");
	if (state.shapeReady) parts.push("shapeReady=true");
	if (state.specReady) parts.push("specReady=true");
	return parts.join(" • ");
}

function getContinuePrompt(state: FlowModeState): string {
	const topicLine = state.topic ? `Topic: ${state.topic}. ` : "Use the current session context. ";

	switch (state.stage) {
		case "think":
			return `${topicLine}Continue the guided /flow pipeline in the think stage. Stay in reasoning mode and move toward a clear ready-to-synthesize outcome. Thinking memos are optional reasoning artifacts only.`;
		case "shape":
			return `${topicLine}Continue the guided /flow pipeline in the shape stage. Work toward a valid brief in docs/briefs/. Use docs/thinking only as optional rationale when helpful, not as the primary artifact.`;
		case "spec":
			return `${topicLine}Continue the guided /flow pipeline in the spec stage. Prefer ${state.briefPath ? `brief \`${state.briefPath}\`` : "docs/briefs/*"} as the primary input. Use ${state.memoPath ? `\`${state.memoPath}\`` : "docs/thinking/*"} only as optional rationale. Do not restate or synthesize the full conversation history when the current session context already contains it.`;
		case "complete":
			return `${topicLine}The guided /flow pipeline is marked complete. Continue with normal post-spec follow-up work only if needed.`;
		default:
			return `${topicLine}Start the guided /flow pipeline from the beginning.`;
	}
}

export default function flowModeExtension(pi: ExtensionAPI): void {
	let latestContext: ExtensionContext | undefined;
	let expectedModalityId: string | undefined;
	let state: FlowModeState = createInitialFlowState();

	function persistState(): void {
		state.updatedAt = new Date().toISOString();
		pi.appendEntry(FLOW_ENTRY_TYPE, state);
	}

	function updateStatus(ctx: ExtensionContext): void {
		latestContext = ctx;
		if (state.stage === "idle") {
			ctx.ui.setStatus("flow-mode", undefined);
			ctx.ui.setWidget("flow-mode", undefined);
			return;
		}

		const stageLabel = getStageLabel(state.stage);
		const prefix = state.stage === "complete" ? "✓" : state.active ? "⇢" : "⏸";
		ctx.ui.setStatus("flow-mode", ctx.ui.theme.fg("accent", `🌊 ${prefix} ${stageLabel}`));

		const pipeline = ["think", "shape", "spec"]
			.map((item) => {
				if (item === state.stage) return ctx.ui.theme.fg("accent", `[${item}]`);
				return ctx.ui.theme.fg("muted", item);
			})
			.join(ctx.ui.theme.fg("muted", " → "));

		const lines = [ctx.ui.theme.fg("accent", `🌊 Guided flow • ${pipeline}`)];
		lines.push(`${ctx.ui.theme.fg("muted", "Current stage:")} ${stageLabel}`);
		if (state.topic) lines.push(`${ctx.ui.theme.fg("muted", "Topic:")} ${state.topic}`);
		lines.push(`${ctx.ui.theme.fg("muted", "Status:")} ${state.active ? "active" : state.stage === "complete" ? "complete" : "paused"}`);
		lines.push(`${ctx.ui.theme.fg("muted", "Readiness:")} think=${state.thinkReady ? "ready" : "in-progress"} • shape=${state.shapeReady ? "ready" : "pending"} • spec=${state.specReady ? "ready" : "pending"}`);
		if (state.memoPath) lines.push(`${ctx.ui.theme.fg("muted", "Thinking memo:")} ${state.memoPath}`);
		if (state.briefPath) lines.push(`${ctx.ui.theme.fg("muted", "Brief:")} ${state.briefPath}`);
		ctx.ui.setWidget("flow-mode", lines);
	}

	function syncThinkState(): void {
		const thinkController = getThinkModeController(pi);
		if (!thinkController) return;

		state = applyThinkStateToFlowState(state, thinkController.getState());
	}

	function syncShapeState(): void {
		const shapeController = getShapeModeController(pi);
		if (!shapeController) return;

		state = applyShapeStateToFlowState(state, shapeController.getState());
	}

	function syncSpecStateFromText(text: string): void {
		state = applySpecTextToFlowState(state, text);
	}

	function syncSpecStateFromController(): void {
		const specController = getSpecModeController(pi);
		if (!specController) return;

		state = applySpecTodosToFlowState(state, specController.getState().todos.length);
	}

	function restoreSessionState(ctx: ExtensionContext): void {
		const entry = ctx.sessionManager
			.getEntries()
			.filter((sessionEntry: { type: string; customType?: string }) => sessionEntry.type === "custom" && sessionEntry.customType === FLOW_ENTRY_TYPE)
			.pop() as { data?: Partial<FlowModeState> } | undefined;

		state = normalizeFlowState(entry?.data);
		syncThinkState();
		syncShapeState();
		syncSpecStateFromController();
		updateStatus(ctx);
	}

	function transitionTo(stage: FlowStage, patch?: Partial<Omit<FlowModeState, "stage">>): void {
		state = transitionFlowState(state, stage, patch);
		persistState();
		if (latestContext) updateStatus(latestContext);
	}

	function resetFlow(): void {
		state = createInitialFlowState();
		persistState();
		if (latestContext) updateStatus(latestContext);
	}

	function pauseFlow(): void {
		state = normalizeFlowState({
			...state,
			active: false,
		});
		persistState();
		if (latestContext) updateStatus(latestContext);
	}

	function resumeFlow(): void {
		state = normalizeFlowState({
			...state,
			active: isActiveStage(state.stage),
		});
		persistState();
		if (latestContext) updateStatus(latestContext);
	}

	function getModalityIdForStage(stage: FlowStage): string | undefined {
		switch (stage) {
			case "think":
				return THINK_MODALITY_ID;
			case "shape":
				return SHAPE_MODALITY_ID;
			case "spec":
				return SPEC_MODALITY_ID;
			default:
				return undefined;
		}
	}

	function stopStage(stage: FlowStage, ctx: ExtensionContext, options?: { restoreTools?: boolean }): void {
		if (stage === "think") {
			getThinkModeController(pi)?.stop(ctx);
			return;
		}

		if (stage === "shape") {
			getShapeModeController(pi)?.stop(ctx, { restoreTools: options?.restoreTools === true });
			return;
		}

		if (stage === "spec") {
			getSpecModeController(pi)?.stop(ctx, { restoreTools: options?.restoreTools === true, preserveTodos: true });
		}
	}

	function stopFlowSession(ctx: ExtensionContext, notify: string, options?: { restoreTools?: boolean }): void {
		stopStage(state.stage, ctx, options);
		resetFlow();
		ctx.ui.notify(notify, "info");
	}

	function suspendFlowSession(ctx: ExtensionContext, notify: string, options?: { restoreTools?: boolean }): void {
		stopStage(state.stage, ctx, options);
		pauseFlow();
		ctx.ui.notify(notify, "info");
	}

	function beginExpectedModality(modalityId: string | undefined): void {
		expectedModalityId = modalityId;
	}

	function clearExpectedModality(modalityId?: string): void {
		if (!modalityId || expectedModalityId === modalityId) {
			expectedModalityId = undefined;
		}
	}

	function getLatestRelevantUserText(ctx: ExtensionCommandContext): string | undefined {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i] as { type: string; message?: AgentMessage };
			if (entry.type !== "message" || !entry.message || entry.message.role !== "user") continue;

			const text = getMessageText(entry.message).trim();
			if (!text) continue;
			if (/^\/flow\b/i.test(text)) continue;
			return text;
		}
		return undefined;
	}

	async function startThinkStage(ctx: ExtensionContext, topic?: string): Promise<boolean> {
		const thinkController = getThinkModeController(pi);
		if (!thinkController) {
			ctx.ui.notify("Flow could not start think mode because the think-mode controller is unavailable.", "error");
			return false;
		}

		if (state.stage !== "idle" && state.stage !== "think" && state.stage !== "complete") {
			stopStage(state.stage, ctx);
		}

		beginExpectedModality(THINK_MODALITY_ID);
		await thinkController.start(
			topic?.trim()
				? { topic: topic.trim() }
				: { useCurrentSessionContext: true },
			ctx as ExtensionCommandContext,
		);
		clearExpectedModality(THINK_MODALITY_ID);
		syncThinkState();
		persistState();
		updateStatus(ctx);
		return true;
	}

	async function startShapeStage(ctx: ExtensionContext): Promise<boolean> {
		const shapeController = getShapeModeController(pi);
		if (!shapeController) {
			ctx.ui.notify("Flow could not start shape mode because the shape-mode controller is unavailable.", "error");
			return false;
		}

		if (state.stage !== "idle" && state.stage !== "shape" && state.stage !== "complete") {
			stopStage(state.stage, ctx);
		}

		beginExpectedModality(SHAPE_MODALITY_ID);
		await shapeController.start(
			state.topic?.trim()
				? { input: state.topic.trim() }
				: { useCurrentSessionContext: true },
			ctx as ExtensionCommandContext,
		);
		clearExpectedModality(SHAPE_MODALITY_ID);
		syncShapeState();
		transitionTo("shape", {
			active: true,
			shapeReady: false,
		});
		ctx.ui.notify("Flow advanced from think to shape.", "info");
		return true;
	}

	function startSpecStage(ctx: ExtensionContext): boolean {
		const specController = getSpecModeController(pi);
		if (!specController) {
			ctx.ui.notify("Flow could not start spec mode because the spec-mode controller is unavailable.", "error");
			return false;
		}

		if (state.stage !== "idle" && state.stage !== "spec" && state.stage !== "complete") {
			stopStage(state.stage, ctx);
		}

		beginExpectedModality(SPEC_MODALITY_ID);
		specController.start(
			{ input: buildSpecRequestInput(state.briefPath, state.memoPath) },
			ctx as ExtensionCommandContext,
		);
		clearExpectedModality(SPEC_MODALITY_ID);
		transitionTo("spec", {
			active: true,
			specReady: false,
		});
		ctx.ui.notify("Flow advanced from shape to spec.", "info");
		return true;
	}

	async function startFlow(ctx: ExtensionCommandContext, topic?: string): Promise<void> {
		const normalizedTopic = topic?.trim() ? topic.trim() : undefined;
		if (state.stage !== "idle" && state.stage !== "complete") {
			stopStage(state.stage, ctx);
		}
		resetFlow();
		transitionTo("think", {
			active: true,
			topic: normalizedTopic,
			memoPath: undefined,
			briefPath: undefined,
			thinkReady: false,
			shapeReady: false,
			specReady: false,
		});

		const thinkStarted = await startThinkStage(ctx, normalizedTopic);
		if (!thinkStarted) {
			resetFlow();
			return;
		}

		if (normalizedTopic) {
			ctx.ui.notify(`Flow started for \"${normalizedTopic}\". Guided pipeline active at think.`, "info");
			return;
		}

		ctx.ui.notify("Flow started from current session context. Guided pipeline active at think.", "info");
	}

	async function promptForTopic(ctx: ExtensionCommandContext): Promise<string | undefined> {
		const topic = await ctx.ui.input(
			"What do you want to run through the think → shape → spec flow?",
			"topic, decision, feature, or project...",
		);
		const normalizedTopic = topic?.trim();
		if (!normalizedTopic) {
			ctx.ui.notify("Flow cancelled.", "info");
			return undefined;
		}
		return normalizedTopic;
	}

	async function startFlowFromEntryPoint(ctx: ExtensionCommandContext): Promise<void> {
		const sessionContext = getLatestRelevantUserText(ctx);
		const entryMode = resolveFlowEntryMode(undefined, Boolean(sessionContext));
		if (entryMode === "current-context") {
			await startFlow(ctx);
			return;
		}

		const topic = await promptForTopic(ctx);
		if (!topic) return;
		await startFlow(ctx, topic);
	}

	async function restartFlowWithNewTopic(ctx: ExtensionCommandContext): Promise<void> {
		const topic = await promptForTopic(ctx);
		if (!topic) return;
		await startFlow(ctx, topic);
	}

	async function continueCurrentStage(ctx: ExtensionCommandContext): Promise<void> {
		if (state.stage === "think") {
			const thinkController = getThinkModeController(pi);
			if (!thinkController?.isEnabled()) {
				await startThinkStage(ctx, state.topic);
				return;
			}
		}

		if (state.stage === "shape") {
			const shapeController = getShapeModeController(pi);
			if (!shapeController?.isEnabled()) {
				await startShapeStage(ctx);
				return;
			}
		}

		if (state.stage === "spec") {
			const specController = getSpecModeController(pi);
			if (!specController?.isEnabled()) {
				startSpecStage(ctx);
				return;
			}
		}

		pi.sendUserMessage(getContinuePrompt(state));
	}

	async function handleExistingFlow(ctx: ExtensionCommandContext): Promise<void> {
		if (state.stage === "complete") {
			const choice = await ctx.ui.select(`Flow complete • ${formatFlowSummary(state)}`, [
				"Start a new flow from current session context",
				"Restart flow with new topic",
				"Clear flow state",
			]);

			if (choice === "Start a new flow from current session context") {
				await startFlowFromEntryPoint(ctx);
			} else if (choice === "Restart flow with new topic") {
				await restartFlowWithNewTopic(ctx);
			} else if (choice === "Clear flow state") {
				resetFlow();
				ctx.ui.notify("Flow cleared.", "info");
			}
			return;
		}

		if (!state.active && state.stage !== "idle") {
			const choice = await ctx.ui.select(`Flow paused • ${formatFlowSummary(state)}`, [
				`Resume ${getStageLabel(state.stage)} stage`,
				"Stop flow",
				state.topic ? `Restart flow for \"${state.topic}\"` : "Restart flow",
				"Restart flow with new topic",
			]);

			if (choice === `Resume ${getStageLabel(state.stage)} stage`) {
				resumeFlow();
				ctx.ui.notify(`Flow resumed at ${getStageLabel(state.stage)}.`, "info");
				await continueCurrentStage(ctx);
			} else if (choice === "Stop flow") {
				stopFlowSession(ctx, "Flow stopped.", { restoreTools: true });
			} else if (choice === (state.topic ? `Restart flow for \"${state.topic}\"` : "Restart flow")) {
				await startFlow(ctx, state.topic);
			} else if (choice === "Restart flow with new topic") {
				await restartFlowWithNewTopic(ctx);
			}
			return;
		}

		const choice = await ctx.ui.select(`Flow active • ${formatFlowSummary(state)}`, [
			`Continue ${getStageLabel(state.stage)} stage`,
			"Pause flow",
			"Stop flow",
			state.topic ? `Restart flow for \"${state.topic}\"` : "Restart flow",
			"Restart flow with new topic",
		]);

		if (choice === `Continue ${getStageLabel(state.stage)} stage`) {
			await continueCurrentStage(ctx);
		} else if (choice === "Pause flow") {
			suspendFlowSession(ctx, `Flow paused at ${getStageLabel(state.stage)}.`, { restoreTools: true });
		} else if (choice === "Stop flow") {
			stopFlowSession(ctx, "Flow stopped.", { restoreTools: true });
		} else if (choice === (state.topic ? `Restart flow for \"${state.topic}\"` : "Restart flow")) {
			await startFlow(ctx, state.topic);
		} else if (choice === "Restart flow with new topic") {
			await restartFlowWithNewTopic(ctx);
		}
	}

	pi.registerCommand("flow", {
		description: "Guided think → shape → spec entrypoint with continue, pause, stop, and restart actions",
		handler: async (args, ctx) => {
			latestContext = ctx;
			const input = args?.trim();

			if (input) {
				await startFlow(ctx, input);
				return;
			}

			if (state.stage === "idle") {
				await startFlowFromEntryPoint(ctx);
				return;
			}

			await handleExistingFlow(ctx);
		},
	});

	pi.on("agent_end", async (_event, ctx) => {
		latestContext = ctx;

		if (state.stage === "think") {
			syncThinkState();
			persistState();
			updateStatus(ctx);

			if (!state.active || !state.thinkReady || !ctx.hasUI) return;

			const choice = await ctx.ui.select("Think stage ready - what next?", [
				"Proceed to /shape",
				"Refine thinking",
				"Stop here",
			]);

			if (choice === "Proceed to /shape") {
				await startShapeStage(ctx);
				return;
			}

			if (choice === "Refine thinking") {
				transitionTo("think", {
					active: true,
					thinkReady: false,
				});
				pi.sendUserMessage(
					"Refine the thinking before shaping. Challenge the current synthesis, tighten the reasoning, and continue in thinking-partner mode.",
					{ deliverAs: "followUp" },
				);
				return;
			}

			if (choice === "Stop here") {
				suspendFlowSession(ctx, "Flow paused after think stage.", { restoreTools: true });
			}
			return;
		}

		if (state.stage === "shape") {
			syncShapeState();
			persistState();
			updateStatus(ctx);

			if (!state.active || !state.shapeReady || !ctx.hasUI) return;

			const choice = await ctx.ui.select("Shape stage ready - what next?", [
				"Proceed to /spec",
				"Refine brief",
				"Ask more questions",
				"Stop here",
			]);

			if (choice === "Proceed to /spec") {
				startSpecStage(ctx);
				return;
			}

			if (choice === "Refine brief") {
				transitionTo("shape", {
					active: true,
					shapeReady: false,
				});
				pi.sendUserMessage("Refine the brief. Tighten the definition, update the brief in docs/briefs/, and keep shaping mode active.", { deliverAs: "followUp" });
				return;
			}

			if (choice === "Ask more questions") {
				transitionTo("shape", {
					active: true,
					shapeReady: false,
				});
				pi.sendUserMessage("Continue shaping. Ask more clarifying questions and resolve any remaining uncertainty before handing off to spec.", { deliverAs: "followUp" });
				return;
			}

			if (choice === "Stop here") {
				suspendFlowSession(ctx, "Flow paused after shape stage.", { restoreTools: true });
			}
			return;
		}

		if (state.stage === "spec") {
			const lastAssistant = [..._event.messages].reverse().find((message) => message.role === "assistant");
			if (lastAssistant) {
				syncSpecStateFromText(getMessageText(lastAssistant as AgentMessage));
			}
			syncSpecStateFromController();
			persistState();

			if (state.specReady) {
				transitionTo("complete", {
					active: false,
					specReady: true,
				});
				ctx.ui.notify("Guided flow complete. Continuing with normal spec follow-up UX.", "info");
				return;
			}

			updateStatus(ctx);
			return;
		}

		updateStatus(ctx);
		persistState();
	});

	pi.events.on(EXCLUSIVE_MODALITY_EVENT, (event: { id?: string; exclusive?: boolean }) => {
		if (!event?.exclusive) return;
		if (event.id && expectedModalityId === event.id) {
			clearExpectedModality(event.id);
			return;
		}
		if (!state.active || !latestContext) return;

		const currentModalityId = getModalityIdForStage(state.stage);
		if (!shouldSuspendFlowForExternalModality({
			active: state.active,
			eventId: event.id,
			currentModalityId,
			expectedModalityId,
		})) {
			return;
		}

		suspendFlowSession(
			latestContext,
			`Flow paused because another modality became active (${event.id}). Use /flow to resume or restart.`,
			{ restoreTools: false },
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		latestContext = ctx;
		syncThinkState();
		syncShapeState();
		syncSpecStateFromController();
		persistState();
		updateStatus(ctx);
	});
}
