// Internal package naming now matches the shape workflow.
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import {
	findLatestShapeDocument,
	findRelevantThinkingMemos,
	isSafeShapeCommand,
	type ShapeDocumentInfo,
} from "./utils.js";

const SHAPE_MODE_TOOLS = ["read", "bash", "grep", "find", "write", "web_search", "question"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write", "web_search"];
const EXCLUSIVE_MODALITY_EVENT = "modality:activated";
const SHAPE_MODALITY_ID = "shape-mode";

export type ShapePhase = "research" | "questioning" | "documenting" | "handoff";

export interface ShapeModeState {
	enabled: boolean;
	phase: ShapePhase;
	topic?: string;
	documentPath?: string;
	documentWritten: boolean;
	documentValid: boolean;
	missingSections: string[];
	missingFrontmatter: string[];
	openQuestions: string[];
	resolvedQuestions: string[];
	relatedThinkingMemos: string[];
	lastUserRequest?: string;
}

export interface ShapeModeStartOptions {
	input?: string;
	useCurrentSessionContext?: boolean;
}

export interface ShapeModeController {
	start(options: ShapeModeStartOptions, ctx: ExtensionCommandContext): Promise<void>;
	stop(ctx: ExtensionContext, options?: { restoreTools?: boolean; notify?: string }): void;
	isEnabled(): boolean;
	getState(): Readonly<ShapeModeState>;
}

const shapeModeControllers = new WeakMap<ExtensionAPI, ShapeModeController>();

export function getShapeModeController(pi: ExtensionAPI): ShapeModeController | undefined {
	return shapeModeControllers.get(pi);
}

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

function topicFromDocument(doc?: ShapeDocumentInfo): string | undefined {
	return doc?.title ?? doc?.topic;
}

function isShapeModeCustomMessage(message: AgentMessage & { customType?: string }): boolean {
	return (
		message.customType === "shape-mode-context" ||
		message.customType === "shape-mode-reminder" ||
		message.customType === "shape-mode-validation" ||
		message.customType === "brainstorm-mode-context" ||
		message.customType === "brainstorm-mode-reminder" ||
		message.customType === "brainstorm-mode-validation"
	);
}

export default function shapeModeExtension(pi: ExtensionAPI): void {
	let latestContext: ExtensionContext | undefined;
	let state: ShapeModeState = {
		enabled: false,
		phase: "research",
		documentWritten: false,
		documentValid: false,
		missingSections: [],
		missingFrontmatter: [],
		openQuestions: [],
		resolvedQuestions: [],
		relatedThinkingMemos: [],
	};

	pi.registerFlag("shape", {
		description: "Start in shape mode (requirements shaping)",
		type: "boolean",
		default: false,
	});

	function currentModeTools(): string[] {
		return state.enabled ? SHAPE_MODE_TOOLS : NORMAL_MODE_TOOLS;
	}

	function persistState(): void {
		pi.appendEntry("shape-mode", state);
	}

	function announceModalityActivation(): void {
		pi.events.emit(EXCLUSIVE_MODALITY_EVENT, { id: SHAPE_MODALITY_ID, exclusive: true });
	}

	function disableShapeMode(ctx: ExtensionContext, options?: { restoreTools?: boolean; notify?: string }): void {
		state.enabled = false;
		state.phase = "research";
		if (options?.restoreTools) {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
		}
		persistState();
		updateStatus(ctx);
		if (options?.notify) ctx.ui.notify(options.notify, "info");
	}

	function applyDocument(doc?: ShapeDocumentInfo): void {
		state.documentPath = doc?.relativePath;
		state.documentWritten = doc !== undefined;
		state.documentValid = doc?.valid ?? false;
		state.missingSections = doc?.missingSections ?? [];
		state.missingFrontmatter = doc?.missingFrontmatter ?? [];
		state.openQuestions = doc?.openQuestions ?? [];
		state.resolvedQuestions = doc?.resolvedQuestions ?? [];
		state.topic = topicFromDocument(doc) ?? state.topic;

		if (doc?.valid && state.openQuestions.length === 0) {
			state.phase = "handoff";
		} else if (doc) {
			state.phase = "documenting";
		}
	}

	async function refreshDocumentState(ctx: ExtensionContext): Promise<void> {
		const doc = await findLatestShapeDocument(ctx.cwd, state.documentPath);
		applyDocument(doc);
	}

	async function refreshThinkingMemoContext(ctx: ExtensionContext, topicHint?: string): Promise<void> {
		const memos = await findRelevantThinkingMemos(ctx.cwd, topicHint ?? state.topic ?? state.lastUserRequest);
		state.relatedThinkingMemos = memos.map((memo) => memo.relativePath);
	}

	function updateStatus(ctx: ExtensionContext): void {
		latestContext = ctx;
		if (!state.enabled) {
			ctx.ui.setStatus("shape-mode", undefined);
			ctx.ui.setWidget("shape-mode", undefined);
			return;
		}

		const phaseLabel =
			state.phase === "handoff"
				? "ready"
				: state.phase === "documenting"
					? "brief"
					: state.phase === "questioning"
						? "questions"
						: "shape";
		ctx.ui.setStatus("shape-mode", ctx.ui.theme.fg("warning", `💭 ${phaseLabel}`));

		const lines = [ctx.ui.theme.fg("accent", `💭 Shape • ${state.phase}`)];
		if (state.topic) lines.push(`${ctx.ui.theme.fg("muted", "Topic:")} ${state.topic}`);
		lines.push(
			`${ctx.ui.theme.fg("muted", "Brief:")} ${state.documentPath ?? ctx.ui.theme.fg("warning", "not written yet")}`,
		);
		if (state.documentWritten) {
			lines.push(
				`${ctx.ui.theme.fg("muted", "Validity:")} ${
					state.documentValid ? ctx.ui.theme.fg("success", "valid") : ctx.ui.theme.fg("warning", "needs updates")
				}`,
			);
		}
		lines.push(`${ctx.ui.theme.fg("muted", "Open questions:")} ${state.openQuestions.length}`);
		if (state.relatedThinkingMemos.length > 0) {
			lines.push(`${ctx.ui.theme.fg("muted", "Thinking memos:")} ${state.relatedThinkingMemos.length}`);
		}
		ctx.ui.setWidget("shape-mode", lines);
	}

	async function restoreSessionState(ctx: ExtensionContext, includeFlag = false): Promise<void> {
		state = {
			enabled: includeFlag && pi.getFlag("shape") === true,
			phase: "research",
			documentWritten: false,
			documentValid: false,
			missingSections: [],
			missingFrontmatter: [],
			openQuestions: [],
			resolvedQuestions: [],
			relatedThinkingMemos: [],
		};

		const entry = ctx.sessionManager
			.getEntries()
			.filter((e: { type: string; customType?: string }) =>
				e.type === "custom" && (e.customType === "shape-mode" || e.customType === "brainstorm-mode"),
			)
			.pop() as { data?: Partial<ShapeModeState> } | undefined;
		if (entry?.data) {
			state = {
				...state,
				...entry.data,
				missingSections: entry.data.missingSections ?? [],
				missingFrontmatter: entry.data.missingFrontmatter ?? [],
				openQuestions: entry.data.openQuestions ?? [],
				resolvedQuestions: entry.data.resolvedQuestions ?? [],
				relatedThinkingMemos: entry.data.relatedThinkingMemos ?? [],
			};
		}

		await refreshDocumentState(ctx);
		await refreshThinkingMemoContext(ctx);
		pi.setActiveTools(currentModeTools());
		updateStatus(ctx);
	}

	async function toggleShapeMode(ctx: ExtensionContext): Promise<void> {
		if (state.enabled) {
			disableShapeMode(ctx, { restoreTools: true, notify: "Shape mode disabled. Full access restored." });
			return;
		}

		announceModalityActivation();
		state.enabled = true;
		state.phase = "research";
		pi.setActiveTools(SHAPE_MODE_TOOLS);
		await refreshThinkingMemoContext(ctx);
		const memoNote = state.relatedThinkingMemos.length > 0 ? ` Found ${state.relatedThinkingMemos.length} recent thinking memo${state.relatedThinkingMemos.length === 1 ? "" : "s"}.` : "";
		ctx.ui.notify(`Shape mode enabled. Tools: ${SHAPE_MODE_TOOLS.join(", ")}.${memoNote}`, "info");
		persistState();
		updateStatus(ctx);
	}

	async function startShapeRequest(input: string, ctx: ExtensionCommandContext): Promise<void> {
		announceModalityActivation();
		if (!state.enabled) {
			state.enabled = true;
			pi.setActiveTools(SHAPE_MODE_TOOLS);
		}

		state.phase = "questioning";
		state.lastUserRequest = input;
		await refreshThinkingMemoContext(ctx, input);
		persistState();
		updateStatus(ctx);
		if (state.relatedThinkingMemos.length > 0) {
			ctx.ui.notify(`Found ${state.relatedThinkingMemos.length} related thinking memo${state.relatedThinkingMemos.length === 1 ? "" : "s"} in docs/thinking/.`, "info");
		}
		pi.sendUserMessage(input);
	}

	async function startShapeFromCurrentSessionContext(ctx: ExtensionCommandContext): Promise<void> {
		announceModalityActivation();
		if (!state.enabled) {
			state.enabled = true;
			pi.setActiveTools(SHAPE_MODE_TOOLS);
		}

		state.phase = "questioning";
		state.lastUserRequest = "current session context";
		await refreshThinkingMemoContext(ctx);
		persistState();
		updateStatus(ctx);
		if (state.relatedThinkingMemos.length > 0) {
			ctx.ui.notify(`Found ${state.relatedThinkingMemos.length} related thinking memo${state.relatedThinkingMemos.length === 1 ? "" : "s"} in docs/thinking/.`, "info");
		}
		pi.sendUserMessage(
			"Begin shaping from the current session context. Use the existing conversation history in this session as your context window. Do not restate or summarize that history back to me unless needed. Infer the thing to shape from the existing context when possible. Start with lightweight repository/context research, then ask one clarifying question using the question tool only if the existing session context is genuinely insufficient.",
		);
	}

	async function startShapeSession(options: ShapeModeStartOptions, ctx: ExtensionCommandContext): Promise<void> {
		if (options.useCurrentSessionContext && !options.input?.trim()) {
			await startShapeFromCurrentSessionContext(ctx);
			return;
		}

		const input = options.input?.trim();
		if (!input) {
			throw new Error("Shape mode requires input unless useCurrentSessionContext is true.");
		}

		await startShapeRequest(input, ctx);
	}

	shapeModeControllers.set(pi, {
		start: async (options, ctx) => startShapeSession(options, ctx),
		stop: (ctx, options) => disableShapeMode(ctx, options),
		isEnabled: () => state.enabled,
		getState: () => ({
			...state,
			missingSections: [...state.missingSections],
			missingFrontmatter: [...state.missingFrontmatter],
			openQuestions: [...state.openQuestions],
			resolvedQuestions: [...state.resolvedQuestions],
			relatedThinkingMemos: [...state.relatedThinkingMemos],
		}),
	});

	pi.registerCommand("shape", {
		description: "Enable shape mode and begin shaping from session context, or start shaping with explicit context",
		handler: async (args, ctx) => {
			const input = args?.trim();
			if (!input) {
				if (state.enabled) {
					await toggleShapeMode(ctx);
				} else {
					await startShapeSession({ useCurrentSessionContext: true }, ctx);
				}
				return;
			}

			await startShapeSession({ input }, ctx);
		},
	});


	pi.registerShortcut(Key.ctrlAlt("b"), {
		description: "Toggle shape mode",
		handler: async (ctx) => toggleShapeMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;

		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (!isSafeShapeCommand(command)) {
				return {
					block: true,
					reason: `Shape mode: command blocked (not allowlisted). Use shaping for exploration and research only.\nCommand: ${command}`,
				};
			}
		}

		if (event.toolName === "edit") {
			return {
				block: true,
				reason: "Shape mode does not allow source-code edits.",
			};
		}
	});

	pi.on("context", async (event) => {
		if (state.enabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (isShapeModeCustomMessage(msg)) return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") return !content.includes("[SHAPE MODE ACTIVE]");
				if (Array.isArray(content)) {
					return !content.some((c) => c.type === "text" && (c as TextContent).text?.includes("[SHAPE MODE ACTIVE]"));
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state.enabled) return;
		const prompt = event.prompt?.trim();
		if (prompt) state.lastUserRequest = prompt;
		if (state.phase === "research") state.phase = "questioning";
		await refreshThinkingMemoContext(ctx, prompt);
		persistState();
		updateStatus(ctx);

		const thinkingMemoContext =
			state.relatedThinkingMemos.length > 0
				? `\nOptional thinking memo context (use only if helpful as rationale/history; do not depend on it):\n${state.relatedThinkingMemos.map((path) => `- ${path}`).join("\n")}`
				: "\nOptional thinking memo context: none found or none clearly relevant. Continue shaping from the user's direct input.";

		return {
			message: {
				customType: "shape-mode-context",
				content: `[SHAPE MODE ACTIVE]
You are in shape mode. Your job is to clarify WHAT to build before planning HOW to implement it.

Rules:
- NEVER write or modify source code.
- Writing the brief is allowed and required.
- Use the question tool for ALL user questions. Ask one question at a time.
- Prefer multiple-choice questions when natural options exist.
- Start with lightweight repository research using read, grep, and find.
- When uncertain about external systems, verify with web_search or bash + authoritative sources.
- Keep outputs concise and focused on requirements, decisions, trade-offs, users, goals, constraints, and success criteria.
- You MUST create a brief at docs/briefs/YYYY-MM-DD-<topic>-brief.md before offering handoff.
- The brief must include frontmatter with date and topic, plus sections: Chosen Thing, Users and Context, Goals, Non-Goals, Constraints, Success Criteria, Candidate Shapes, Chosen Shape, Key Decisions, Open Questions, Next Step.
- If Open Questions remain unresolved, continue questioning instead of handing off to planning.
- Do not present planning handoff until the brief exists and is valid.
- Relevant files in docs/thinking/ are optional context only. Use them for rationale/history when useful, but shaping must still work from direct user input alone.

Current known topic: ${state.topic ?? "Unknown"}
Current brief: ${state.documentPath ?? "Not written yet"}
Open questions tracked: ${state.openQuestions.length}${thinkingMemoContext}`,
				display: false,
			},
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!state.enabled) return;

		const branchMessages = event.messages as AgentMessage[];
		state.lastUserRequest = getLatestUserText(branchMessages) ?? state.lastUserRequest;
		await refreshDocumentState(ctx);
		persistState();
		updateStatus(ctx);

		if (!ctx.hasUI) return;

		if (!state.documentWritten) {
			pi.sendMessage(
				{
					customType: "shape-mode-reminder",
					content: "**Shape mode active**\n\nThe shape is not complete until a brief is written to `docs/briefs/YYYY-MM-DD-<topic>-brief.md`.",
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		if (!state.documentValid) {
			const missing = [
				...state.missingFrontmatter.map((item) => `frontmatter: ${item}`),
				...state.missingSections.map((item) => `section: ${item}`),
			]
				.map((item) => `- ${item}`)
				.join("\n");
			pi.sendMessage(
				{
					customType: "shape-mode-validation",
					content: `**Brief needs updates**\n\nBrief: \`${state.documentPath}\`\n\nMissing pieces:\n${missing}`,
					display: true,
				},
				{ triggerTurn: false },
			);
			return;
		}

		if (state.openQuestions.length > 0) {
			const choice = await ctx.ui.select("Shape mode - unresolved brief questions remain", [
				"Continue questioning",
				"Refine the brief",
				"Done for now",
			]);
			if (choice === "Continue questioning") {
				state.phase = "questioning";
				persistState();
				updateStatus(ctx);
				pi.sendUserMessage(
					"Continue shaping. Resolve the remaining open questions one at a time using the question tool.",
					{ deliverAs: "followUp" },
				);
			} else if (choice === "Refine the brief") {
				const refinement = await ctx.ui.editor("Refine the brief:", "");
				if (refinement?.trim()) {
					state.phase = "documenting";
					persistState();
					updateStatus(ctx);
					pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
				}
			}
			return;
		}

		state.phase = "handoff";
		persistState();
		updateStatus(ctx);

		const choice = await ctx.ui.select("Brief ready for /spec - what next?", [
			"Review and refine",
			"Proceed to /spec",
			"Ask more questions",
			"Done for now",
		]);

		if (choice === "Review and refine") {
			const refinement = await ctx.ui.editor("Refine the brief:", "");
			if (refinement?.trim()) {
				state.phase = "documenting";
				persistState();
				updateStatus(ctx);
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		} else if (choice === "Proceed to /spec") {
			ctx.ui.setEditorText("/spec");
			ctx.ui.notify('Brief ready. Press Enter to run "/spec".', "info");
		} else if (choice === "Ask more questions") {
			state.phase = "questioning";
			persistState();
			updateStatus(ctx);
			pi.sendUserMessage("Continue shaping. Ask one clarifying question at a time using the question tool.", { deliverAs: "followUp" });
		}
	});

	pi.events.on(EXCLUSIVE_MODALITY_EVENT, (event: { id?: string; exclusive?: boolean }) => {
		if (!event?.exclusive || event.id === SHAPE_MODALITY_ID || !state.enabled || !latestContext) return;
		disableShapeMode(latestContext, { notify: "Shape mode disabled because another modality became active." });
	});

	pi.on("session_start", async (_event, ctx) => {
		await restoreSessionState(ctx, true);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await restoreSessionState(ctx, false);
	});
}
