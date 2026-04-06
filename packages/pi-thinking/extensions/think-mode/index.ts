import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";

export type ThinkPhase = "idle" | "intake" | "exploring" | "challenging" | "synthesizing" | "closing";

export type ThinkReadiness = "exploring" | "ready-to-synthesize";

export interface ThinkModeState {
	enabled: boolean;
	phase: ThinkPhase;
	topic?: string;
	activeProblem?: string;
	selectedModels: string[];
	assumptions: string[];
	openQuestions: string[];
	emergingConclusion?: string;
	readiness: ThinkReadiness;
	memoPath?: string;
	shouldOfferSave: boolean;
}

export interface ThinkModeStartOptions {
	topic?: string;
	useCurrentSessionContext?: boolean;
}

export interface ThinkModeController {
	start(options: ThinkModeStartOptions, ctx: ExtensionCommandContext): Promise<void>;
	stop(ctx: ExtensionContext, notify?: string): void;
	isEnabled(): boolean;
	getState(): Readonly<ThinkModeState>;
}

const thinkModeControllers = new WeakMap<ExtensionAPI, ThinkModeController>();

export function getThinkModeController(pi: ExtensionAPI): ThinkModeController | undefined {
	return thinkModeControllers.get(pi);
}

const INITIAL_STATE: ThinkModeState = {
	enabled: false,
	phase: "idle",
	selectedModels: [],
	assumptions: [],
	openQuestions: [],
	readiness: "exploring",
	shouldOfferSave: false,
};

const EXCLUSIVE_MODALITY_EVENT = "modality:activated";
const THINK_MODALITY_ID = "think-mode";

function cloneInitialState(): ThinkModeState {
	return {
		...INITIAL_STATE,
		selectedModels: [],
		assumptions: [],
		openQuestions: [],
	};
}

const MODEL_CANDIDATES = [
	"First Principles",
	"Inversion",
	"Second-Order Thinking",
	"Opportunity Cost",
	"Regret Minimization",
	"Reversibility Test",
	"Decision Matrix",
	"Pre-Mortem",
	"Scenario Planning",
	"SWOT",
	"Steel Manning",
	"Bayesian Updating",
	"5 Whys",
	"Constraint Analysis",
	"Circle of Concern vs Influence",
] as const;

function getMessageText(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getLatestUserText(messages: AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role !== "user") continue;
		const text = getMessageText(messages[i]).trim();
		if (text) return text;
	}
	return undefined;
}

function detectModels(text: string): string[] {
	const found: string[] = [];
	for (const candidate of MODEL_CANDIDATES) {
		const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) found.push(candidate);
		if (found.length >= 3) break;
	}
	return found;
}

function detectAssumptions(text: string): string[] {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const assumptions = lines
		.filter((line) => /assum|depends on|this requires|this only works if/i.test(line))
		.map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
		.filter((line) => line.length > 0)
		.slice(0, 4);

	return [...new Set(assumptions)];
}

function detectEmergingConclusion(text: string): string | undefined {
	const patterns = [
		/^(?:Key insight|Decision|Bottom line|Next step):\s*(.+)$/im,
		/^In summary[:,]?\s*(.+)$/im,
		/^So the move is to\s+(.+)$/im,
	];
	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]?.trim()) return match[1].trim();
	}
	return undefined;
}

function detectOpenQuestions(text: string): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.endsWith("?"))
		.slice(0, 3);
}

function formatDate(date = new Date()): string {
	return date.toISOString().slice(0, 10);
}

function slugifyTopic(topic?: string): string {
	return (topic ?? "thinking-session")
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "thinking-session";
}

function buildMemoPath(topic?: string, date = new Date()): string {
	return `docs/thinking/${formatDate(date)}-${slugifyTopic(topic)}-think.md`;
}

function buildMemoTemplate(state: ThinkModeState, date = new Date()): string {
	const topic = state.activeProblem ?? state.topic ?? "Thinking Session";
	const selectedModels = state.selectedModels.length > 0 ? state.selectedModels.map((model) => `- ${model}`).join("\n") : "- None recorded yet";
	const assumptions = state.assumptions.length > 0 ? state.assumptions.map((assumption) => `- ${assumption}`).join("\n") : "- None recorded yet";
	const tensionsAndQuestions =
		state.openQuestions.length > 0
			? state.openQuestions.map((question) => `- ${question}`).join("\n")
			: "- Add the strongest unresolved tension, counterargument, or open question here";
	const currentView = state.emergingConclusion ?? "Add the current synthesis or best working view from the session.";

	return `---
date: ${formatDate(date)}
topic: ${slugifyTopic(topic)}
artifact: thinking-memo
source: /think
---

# ${topic}

## Question or Topic
${topic}

## Current View
${currentView}

## Key Insights
- Add the most important insight from the session
- Add the trade-off, tension, or surprise that mattered most

## Mental Models Used
${selectedModels}

## Assumptions to Monitor
${assumptions}

## Tensions and Open Questions
${tensionsAndQuestions}

## Possible Next Moves
- Continue thinking from a different angle
- Gather missing evidence or examples
- Revisit once one of the assumptions changes
`;
}

export default function thinkModeExtension(pi: ExtensionAPI): void {
	let latestContext: ExtensionContext | undefined;
	let state: ThinkModeState = cloneInitialState();

	function updateStatus(ctx: ExtensionContext): void {
		latestContext = ctx;
		if (!state.enabled) {
			ctx.ui.setStatus("think-mode", undefined);
			ctx.ui.setWidget("think-mode", undefined);
			return;
		}

		ctx.ui.setStatus("think-mode", ctx.ui.theme.fg("accent", `🧠 ${state.phase}`));

		const lines = [ctx.ui.theme.fg("accent", `🧠 Think • ${state.phase}`)];
		if (state.activeProblem ?? state.topic) {
			lines.push(`${ctx.ui.theme.fg("muted", "Topic:")} ${state.activeProblem ?? state.topic}`);
		}
		lines.push(`${ctx.ui.theme.fg("muted", "Readiness:")} ${state.readiness}`);
		if (state.selectedModels.length > 0) {
			lines.push(`${ctx.ui.theme.fg("muted", "Models:")} ${state.selectedModels.join(", ")}`);
		}
		if (state.openQuestions.length > 0) {
			lines.push(`${ctx.ui.theme.fg("muted", "Open questions:")} ${state.openQuestions.length}`);
		}
		if (state.emergingConclusion) {
			lines.push(`${ctx.ui.theme.fg("muted", "Current synthesis:")} ${state.emergingConclusion}`);
		}
		if (state.memoPath) {
			lines.push(`${ctx.ui.theme.fg("muted", "Memo:")} ${state.memoPath}`);
		}
		ctx.ui.setWidget("think-mode", lines);
	}

	function persistState(): void {
		pi.appendEntry("think-mode", state);
	}

	function announceModalityActivation(): void {
		pi.events.emit(EXCLUSIVE_MODALITY_EVENT, { id: THINK_MODALITY_ID, exclusive: true });
	}

	function disableThinkSession(ctx: ExtensionContext, notify?: string): void {
		state = cloneInitialState();
		persistState();
		updateStatus(ctx);
		if (notify) ctx.ui.notify(notify, "info");
	}

	function restoreSessionState(ctx: ExtensionContext): void {
		state = cloneInitialState();

		const entry = ctx.sessionManager
			.getEntries()
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "think-mode")
			.pop() as { data?: Partial<ThinkModeState> } | undefined;

		if (entry?.data) {
			state = {
				...state,
				...entry.data,
				selectedModels: entry.data.selectedModels ?? [],
				assumptions: entry.data.assumptions ?? [],
				openQuestions: entry.data.openQuestions ?? [],
				readiness: entry.data.readiness ?? "exploring",
			};
		}

		updateStatus(ctx);
	}

	async function startThinkFromTopic(topic: string, ctx: ExtensionCommandContext): Promise<void> {
		announceModalityActivation();
		state.enabled = true;
		state.topic = topic.trim();
		state.activeProblem = topic.trim();
		state.phase = "intake";
		state.selectedModels = [];
		state.assumptions = [];
		state.openQuestions = [];
		state.emergingConclusion = undefined;
		state.readiness = "exploring";
		state.memoPath = undefined;
		state.shouldOfferSave = false;
		persistState();
		updateStatus(ctx);

		pi.sendUserMessage(`Help me think through this: ${state.topic}`);
	}

	async function startThinkFromCurrentSessionContext(ctx: ExtensionCommandContext): Promise<void> {
		announceModalityActivation();
		state.enabled = true;
		state.topic = undefined;
		state.activeProblem = undefined;
		state.phase = "intake";
		state.selectedModels = [];
		state.assumptions = [];
		state.openQuestions = [];
		state.emergingConclusion = undefined;
		state.readiness = "exploring";
		state.memoPath = undefined;
		state.shouldOfferSave = false;
		persistState();
		updateStatus(ctx);

		pi.sendUserMessage(
			"Help me think through this using the current session context. Use the existing conversation history in this session as your context window when possible. Do not restate or summarize the full history unless needed. Start by identifying the core decision, problem, or idea from the current context, then continue in thinking-partner mode.",
		);
	}

	async function startThinkSession(options: ThinkModeStartOptions, ctx: ExtensionCommandContext): Promise<void> {
		if (options.useCurrentSessionContext && !options.topic?.trim()) {
			await startThinkFromCurrentSessionContext(ctx);
			return;
		}

		const topic = options.topic?.trim();
		if (!topic) {
			throw new Error("Think mode requires a topic unless useCurrentSessionContext is true.");
		}

		await startThinkFromTopic(topic, ctx);
	}

	thinkModeControllers.set(pi, {
		start: async (options, ctx) => startThinkSession(options, ctx),
		stop: (ctx, notify) => disableThinkSession(ctx, notify),
		isEnabled: () => state.enabled,
		getState: () => ({
			...state,
			selectedModels: [...state.selectedModels],
			assumptions: [...state.assumptions],
			openQuestions: [...state.openQuestions],
		}),
	});

	pi.registerCommand("think", {
		description: "Toggle think mode, or start a guided thinking-partner session with a topic",
		handler: async (args, ctx: ExtensionCommandContext) => {
			let topic = args?.trim();

			if (!topic) {
				if (state.enabled) {
					disableThinkSession(ctx, "Think mode disabled.");
					return;
				}

				topic = await ctx.ui.input("What do you want to think through?", "decision, problem, or idea...");
				if (!topic?.trim()) {
					ctx.ui.notify("Think session cancelled.", "info");
					return;
				}
			}

			await startThinkSession({ topic }, ctx);
		},
	});

	// V1 scope is intentionally narrow:
	// - guided thinking workflow only
	// - no extra mode mechanics like shortcuts, flags, tool restrictions, or handoff systems
	// Add more only if they directly improve the thinking-partner experience.

	pi.on("context", async (event) => {
		if (state.enabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "think-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") return !content.includes("[THINK MODE ACTIVE]");
				if (Array.isArray(content)) {
					return !content.some((c) => c.type === "text" && (c as TextContent).text?.includes("[THINK MODE ACTIVE]"));
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state.enabled) return;

		const prompt = event.prompt?.trim();
		if (prompt && !state.topic) state.topic = prompt;
		if (prompt && !state.activeProblem) state.activeProblem = prompt;
		if (state.phase === "idle") state.phase = "intake";
		persistState();
		updateStatus(ctx);

		return {
			message: {
				customType: "think-mode-context",
				content: `[THINK MODE ACTIVE]
You are acting as a deterministic thinking partner.

Operating style:
- Sharpen how the user thinks, not just what they conclude.
- Ask one question at a time.
- Be respectful, direct, and willing to challenge weak reasoning.
- Prefer synthesis over lectures.
- Name mental models when you apply them.
- Surface assumptions, trade-offs, second-order effects, and missing evidence.
- If the user seems attached to a conclusion, gently stress-test it instead of validating it.
- If the situation is ambiguous, ask a single clarifying question before deeper analysis.
- Use 2-3 relevant mental models, not a long list.
- End turns concisely and keep momentum.

Current think session:
- Topic: ${state.activeProblem ?? state.topic ?? "Unknown"}
- Phase: ${state.phase}
- Readiness: ${state.readiness}
- Selected models: ${state.selectedModels.length > 0 ? state.selectedModels.join(", ") : "None yet"}
- Surfaced assumptions: ${state.assumptions.length > 0 ? state.assumptions.join(" | ") : "None yet"}
- Open questions: ${state.openQuestions.length > 0 ? state.openQuestions.join(" | ") : "None yet"}
- Current synthesis: ${state.emergingConclusion ?? "None yet"}

Keep this fully standalone. Do not turn it into a project brief, implementation plan, or planning handoff. Stay in thinking-partner mode.`,
				display: false,
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.enabled) return;

		const messages = event.messages as AgentMessage[];
		const latestUserText = getLatestUserText(messages);
		if (latestUserText?.trim()) {
			state.activeProblem = latestUserText.trim();
			if (!state.topic) state.topic = latestUserText.trim();
		}

		const assistantMessages = messages.filter((message) => message.role === "assistant");
		const latestAssistantText = assistantMessages.length > 0 ? getMessageText(assistantMessages[assistantMessages.length - 1]).trim() : "";

		if (latestAssistantText) {
			const models = detectModels(latestAssistantText);
			if (models.length > 0) state.selectedModels = models;

			const assumptions = detectAssumptions(latestAssistantText);
			if (assumptions.length > 0) state.assumptions = assumptions;

			state.openQuestions = detectOpenQuestions(latestAssistantText);

			const conclusion = detectEmergingConclusion(latestAssistantText);
			if (conclusion) state.emergingConclusion = conclusion;

			state.readiness = conclusion || /\b(synthesize|synthesis|summary|in summary|bottom line|next step)\b/i.test(latestAssistantText)
				? "ready-to-synthesize"
				: "exploring";
			state.phase = state.readiness === "ready-to-synthesize" ? "synthesizing" : "exploring";
		}

		persistState();
		updateStatus(ctx);

		if (!ctx.hasUI || state.openQuestions.length > 0) return;

		if (state.readiness === "ready-to-synthesize") {
			state.shouldOfferSave = true;
			persistState();
			updateStatus(ctx);

			const closeoutChoice = await ctx.ui.select("Think session - wrap up", [
				"Don't save",
				"Save thinking memo",
				"Refine first",
			]);

			if (!closeoutChoice || closeoutChoice === "Don't save") {
				state.shouldOfferSave = false;
				state.phase = "closing";
				persistState();
				updateStatus(ctx);
				ctx.ui.notify("Think session closed without saving.", "info");
				return;
			}

			if (closeoutChoice === "Save thinking memo") {
				state.phase = "closing";
				state.memoPath = buildMemoPath(state.activeProblem ?? state.topic);
				persistState();
				updateStatus(ctx);
				pi.sendMessage(
					{
						customType: "think-mode-save-request",
						content: `**Thinking memo ready to save**

Target: \`${state.memoPath}\`

This is a standalone thinking artifact for reasoning, tensions, and open questions.
Do not turn it into a brief or implementation plan.

Memo format:
- Question or Topic
- Current View
- Key Insights
- Mental Models Used
- Assumptions to Monitor
- Tensions and Open Questions
- Possible Next Moves

Suggested template:

\`\`\`markdown
${buildMemoTemplate(state)}
\`\`\``,
						display: true,
					},
					{ triggerTurn: false },
				);
				return;
			}

			if (closeoutChoice === "Refine first") {
				state.shouldOfferSave = false;
				state.phase = "challenging";
				persistState();
				updateStatus(ctx);
				pi.sendUserMessage(
					"Refine the analysis before closing. Challenge the current synthesis, tighten the reasoning, and ask one question or offer one focused improvement.",
					{ deliverAs: "followUp" },
				);
				return;
			}
		}

		// Mid-session steering is intentionally passive in v1.
		// Let the conversation flow naturally and only interrupt at meaningful boundaries,
		// such as the end-of-session save/refine closeout above.
	});

	pi.events.on(EXCLUSIVE_MODALITY_EVENT, (event: { id?: string; exclusive?: boolean }) => {
		if (!event?.exclusive || event.id === THINK_MODALITY_ID || !state.enabled || !latestContext) return;
		disableThinkSession(latestContext, "Think mode disabled because another modality became active.");
	});

	pi.on("session_start", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreSessionState(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		updateStatus(ctx);
		persistState();
	});
}
