/**
 * Spec Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /spec command or Ctrl+Alt+P to start/stop spec mode
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered spec steps from "Spec:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import { SessionManager, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

const SPEC_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "web_search"];
const FALLBACK_NORMAL_TOOLS = ["read", "bash", "edit", "write", "web_search"];
const EXCLUSIVE_MODALITY_EVENT = "modality:activated";
const SPEC_MODALITY_ID = "spec-mode";
const HANDOFF_AUTO_COMPACT_RESERVE_TOKENS = 16384;
const HANDOFF_AUTO_COMPACT_PERCENT = 0.85;
const HANDOFF_AUTO_COMPACT_INSTRUCTIONS = `Preserve the handed-off spec context, including:
- the original request
- the spec output and rationale
- the extracted tasks / remaining steps
- implementation progress and decisions made so far
- any blockers, open questions, or follow-up work

Keep the summary actionable for continuing spec execution in this session.`;

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getMessageTextContent(message: AgentMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

interface SpecContextSnapshot {
	request?: string;
	response?: string;
}

export interface SpecModeStartOptions {
	input?: string;
	useCurrentSessionContext?: boolean;
}

export interface SpecModeStateSnapshot {
	enabled: boolean;
	executing: boolean;
	todos: TodoItem[];
}

export interface SpecModeController {
	start(options: SpecModeStartOptions, ctx: ExtensionCommandContext): void;
	stop(ctx: ExtensionContext, options?: { restoreTools?: boolean; notify?: string; preserveTodos?: boolean }): void;
	isEnabled(): boolean;
	isExecuting(): boolean;
	getState(): Readonly<SpecModeStateSnapshot>;
}

const specModeControllers = new WeakMap<ExtensionAPI, SpecModeController>();

export function getSpecModeController(pi: ExtensionAPI): SpecModeController | undefined {
	return specModeControllers.get(pi);
}

function getLatestSpecContext(messages: AgentMessage[]): SpecContextSnapshot | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (!isAssistantMessage(message)) continue;

		const response = getTextContent(message).trim();
		if (extractTodoItems(response).length === 0) continue;

		let request: string | undefined;
		for (let j = i - 1; j >= 0; j--) {
			const previous = messages[j];
			if (previous.role !== "user") continue;

			const text = getMessageTextContent(previous).trim();
			if (text) {
				request = text;
				break;
			}
		}

		return { request, response };
	}

	return undefined;
}

function getLatestCustomEntryIndex(entries: Array<{ type: string; customType?: string }>, customTypes: string[]): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType && customTypes.includes(entry.customType)) {
			return i;
		}
	}

	return -1;
}

function shouldAutoStartHandoffExecution(entries: Array<{ type: string; customType?: string }>): boolean {
	const pendingIndex = getLatestCustomEntryIndex(entries, [
		"spec-mode-handoff-pending-start",
		"plan-mode-handoff-pending-start",
	]);
	if (pendingIndex === -1) return false;

	const startedIndex = getLatestCustomEntryIndex(entries, [
		"spec-mode-handoff-started",
		"plan-mode-handoff-started",
	]);
	return startedIndex < pendingIndex;
}

export default function specModeExtension(pi: ExtensionAPI): void {
	let latestContext: ExtensionContext | undefined;
	let specModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let handoffAutoCompactionEnabled = false;
	let handoffAutoCompactionInFlight = false;
	let executionCompletedCountAtAgentStart = 0;
	let normalModeTools: string[] | undefined;

	function captureNormalModeTools(): void {
		if (normalModeTools) return;
		const active = pi.getActiveTools();
		normalModeTools = active.length > 0 ? [...active] : [...FALLBACK_NORMAL_TOOLS];
	}

	function restoreNormalModeTools(): void {
		pi.setActiveTools(normalModeTools ?? FALLBACK_NORMAL_TOOLS);
	}

	function announceModalityActivation(): void {
		pi.events.emit(EXCLUSIVE_MODALITY_EVENT, { id: SPEC_MODALITY_ID, exclusive: true });
	}

	function currentModeTools(): string[] {
		return specModeEnabled ? SPEC_MODE_TOOLS : (normalModeTools ?? FALLBACK_NORMAL_TOOLS);
	}

	function updateStatus(ctx: ExtensionContext): void {
		latestContext = ctx;
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("spec-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (specModeEnabled) {
			ctx.ui.setStatus("spec-mode", ctx.ui.theme.fg("warning", "⏸ spec"));
		} else {
			ctx.ui.setStatus("spec-mode", undefined);
		}

		if (executionMode && todoItems.length > 0) {
			const completedItems = todoItems.filter((item) => item.completed);
			const remainingItems = todoItems.filter((item) => !item.completed);
			const lines = [
				ctx.ui.theme.fg(
					"accent",
					`📋 ${completedItems.length}/${todoItems.length} complete • ${remainingItems.length} remaining`,
				),
			];
			if (remainingItems.length > 0) {
				lines.push(`${ctx.ui.theme.fg("warning", "→ ")}${remainingItems[0].text}`);
				for (const item of remainingItems.slice(1)) {
					lines.push(`${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`);
				}
			} else {
				lines.push(ctx.ui.theme.fg("success", "All spec steps completed"));
			}
			ctx.ui.setWidget("spec-todos", lines);
		} else {
			ctx.ui.setWidget("spec-todos", undefined);
		}
	}

	function disableSpecMode(
		ctx: ExtensionContext,
		options?: { restoreTools?: boolean; notify?: string; preserveTodos?: boolean },
	): void {
		specModeEnabled = false;
		executionMode = false;
		if (!options?.preserveTodos) {
			todoItems = [];
		}
		if (options?.restoreTools) {
			restoreNormalModeTools();
		}
		updateStatus(ctx);
		persistState();
		if (options?.notify) ctx.ui.notify(options.notify, "info");
	}

	function toggleSpecMode(ctx: ExtensionContext): void {
		if (specModeEnabled) {
			disableSpecMode(ctx, { restoreTools: true, notify: "Spec mode disabled. Normal tools restored." });
			return;
		}

		announceModalityActivation();
		specModeEnabled = true;
		executionMode = false;
		todoItems = [];
		captureNormalModeTools();
		pi.setActiveTools(SPEC_MODE_TOOLS);
		ctx.ui.notify(`Spec mode enabled. Tools: ${SPEC_MODE_TOOLS.join(", ")}`);
		updateStatus(ctx);
	}

	function persistState(): void {
		pi.appendEntry("spec-mode", {
			enabled: specModeEnabled,
			todos: todoItems,
			executing: executionMode,
		});
	}

	function restoreSessionState(ctx: ExtensionContext, includeFlag = false): void {
		specModeEnabled = includeFlag && pi.getFlag("spec") === true;
		executionMode = false;
		todoItems = [];
		handoffAutoCompactionEnabled = false;
		handoffAutoCompactionInFlight = false;
		executionCompletedCountAtAgentStart = 0;

		const entries = ctx.sessionManager.getEntries();

		// Support restoring from old plan-mode sessions too
		const specModeEntry = entries
			.filter((e: { type: string; customType?: string }) =>
				e.type === "custom" && (e.customType === "spec-mode" || e.customType === "plan-mode"),
			)
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } } | undefined;

		if (specModeEntry?.data) {
			specModeEnabled = specModeEntry.data.enabled ?? specModeEnabled;
			todoItems = specModeEntry.data.todos ?? todoItems;
			executionMode = specModeEntry.data.executing ?? executionMode;
		}

		const autoCompactionEntry = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" &&
					(e.customType === "spec-mode-auto-compaction" || e.customType === "plan-mode-auto-compaction"),
			)
			.pop() as { data?: { enabled?: boolean } } | undefined;
		handoffAutoCompactionEnabled = autoCompactionEntry?.data?.enabled === true;

		const isResume = specModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "spec-mode-execute" || entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}

			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		pi.setActiveTools(currentModeTools());
		updateStatus(ctx);
	}

	function maybeAutoCompactHandoffSession(ctx: ExtensionContext): void {
		if (!handoffAutoCompactionEnabled || handoffAutoCompactionInFlight) return;

		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens === null) return;

		const reserveThreshold = usage.contextWindow - HANDOFF_AUTO_COMPACT_RESERVE_TOKENS;
		const earlyThreshold = Math.floor(usage.contextWindow * HANDOFF_AUTO_COMPACT_PERCENT);
		const threshold = Math.min(reserveThreshold, earlyThreshold);
		if (usage.tokens <= threshold) return;

		handoffAutoCompactionInFlight = true;
		ctx.ui.notify("Auto-compacting handoff session…", "info");
		ctx.compact({
			customInstructions: HANDOFF_AUTO_COMPACT_INSTRUCTIONS,
			onComplete: () => {
				handoffAutoCompactionInFlight = false;
				ctx.ui.notify("Handoff session compaction completed.", "info");
			},
			onError: (error) => {
				handoffAutoCompactionInFlight = false;
				ctx.ui.notify(`Handoff session compaction failed: ${error.message}`, "error");
			},
		});
	}

	function startExecution(ctx: ExtensionContext, options?: { deliverAs?: "steer" | "followUp" }): void {
		specModeEnabled = false;
		executionMode = todoItems.length > 0;
		restoreNormalModeTools();
		updateStatus(ctx);
		persistState();
		pi.appendEntry("spec-mode-execute", {
			startedAt: new Date().toISOString(),
			todos: todoItems.map((item) => ({ ...item })),
		});

		const nextStep = todoItems.find((item) => !item.completed);
		const execMessage = nextStep
			? `Begin spec execution. Execute step ${nextStep.step}: ${nextStep.fullText ?? nextStep.text}. Complete only this step, include [DONE:${nextStep.step}] when finished, and then stop so the system can continue automatically.`
			: "Execute the spec you just created.";

		pi.sendUserMessage(execMessage, options?.deliverAs ? { deliverAs: options.deliverAs } : undefined);
	}

	function scheduleHandoffExecutionStart(ctx: ExtensionContext): void {
		pi.appendEntry("spec-mode-handoff-started", {
			startedAt: new Date().toISOString(),
		});
		setTimeout(() => startExecution(ctx), 0);
	}

	function beginSpecRequest(input: string, ctx: ExtensionCommandContext): void {
		if (!specModeEnabled) {
			announceModalityActivation();
			specModeEnabled = true;
			executionMode = false;
			todoItems = [];
			captureNormalModeTools();
			pi.setActiveTools(SPEC_MODE_TOOLS);
			ctx.ui.notify(`Spec mode enabled. Tools: ${SPEC_MODE_TOOLS.join(", ")}`);
			updateStatus(ctx);
			persistState();
		} else if (executionMode) {
			announceModalityActivation();
			specModeEnabled = true;
			executionMode = false;
			captureNormalModeTools();
			pi.setActiveTools(SPEC_MODE_TOOLS);
			updateStatus(ctx);
			persistState();
		} else {
			announceModalityActivation();
		}

		pi.sendUserMessage(input);
	}

	function beginSpecFromCurrentContext(ctx: ExtensionCommandContext): void {
		beginSpecRequest(
			"Begin the implementation spec stage from the current session context. Use the existing conversation history in this session as your context window. Read relevant docs/briefs first and treat them as primary input. Do not restate or summarize the full history unless needed. Produce the result under a `Spec:` header followed by numbered steps.",
			ctx,
		);
	}

	function startSpecSession(options: SpecModeStartOptions, ctx: ExtensionCommandContext): void {
		if (options.useCurrentSessionContext && !options.input?.trim()) {
			beginSpecFromCurrentContext(ctx);
			return;
		}

		const input = options.input?.trim();
		if (!input) {
			throw new Error("Spec mode requires input unless useCurrentSessionContext is true.");
		}

		beginSpecRequest(input, ctx);
	}

	specModeControllers.set(pi, {
		start: (options, ctx) => startSpecSession(options, ctx),
		stop: (ctx, options) => disableSpecMode(ctx, options),
		isEnabled: () => specModeEnabled,
		isExecuting: () => executionMode,
		getState: () => ({
			enabled: specModeEnabled,
			executing: executionMode,
			todos: todoItems.map((item) => ({ ...item })),
		}),
	});

	pi.registerFlag("spec", {
		description: "Start in spec mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("spec", {
		description: "Enable spec mode and begin from current context, or run an explicit spec request",
		handler: async (args, ctx) => {
			const input = args?.trim();
			if (!input) {
				if (specModeEnabled || executionMode) {
					disableSpecMode(ctx, { restoreTools: true, notify: "Spec mode disabled. Normal tools restored." });
				} else {
					startSpecSession({ useCurrentSessionContext: true }, ctx);
				}
				return;
			}

			startSpecSession({ input }, ctx);
		},
	});

	pi.registerCommand("todos", {
		description: "Show current spec todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a spec first with /spec", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Spec Progress:\n${list}`, "info");
		},
	});

	pi.registerCommand("spec-handoff", {
		description: "Execute the current spec in a new session",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (todoItems.length === 0 && !specModeEnabled) {
				ctx.ui.notify("No active spec to execute. Use /spec first.", "warning");
				return;
			}

			const todosSnapshot = todoItems.map((item) => ({ ...item }));
			const branchMessages = ctx.sessionManager
				.getBranch()
				.filter((entry): entry is { type: "message"; message: AgentMessage } => entry.type === "message")
				.map((entry) => entry.message);
			const specContext = getLatestSpecContext(branchMessages);
			const parentSession = ctx.sessionManager.getSessionFile();
			const handoffSession = SessionManager.create(
				ctx.sessionManager.getCwd(),
				ctx.sessionManager.getSessionDir(),
			);

			if (parentSession) {
				handoffSession.newSession({ parentSession });
			}

			const sections = ["[SPEC HANDOFF FROM PARENT SESSION]"];

			if (specContext?.request?.trim()) {
				sections.push(`Original request:\n${specContext.request.trim()}`);
			}

			if (specContext?.response?.trim()) {
				sections.push(`Spec output:\n${specContext.response.trim()}`);
			}

			if (todosSnapshot.length > 0) {
				const specText = todosSnapshot.map((item) => `${item.step}. ${item.fullText ?? item.text}`).join("\n");
				sections.push(`Extracted tasks:\n${specText}`);
			}

			handoffSession.appendCustomMessageEntry("spec-mode-handoff", sections.join("\n\n"), true, {
				todos: todosSnapshot,
				specContext,
			});
			handoffSession.appendCustomEntry("spec-mode", {
				enabled: false,
				todos: todosSnapshot,
				executing: todosSnapshot.length > 0,
			});
			handoffSession.appendCustomEntry("spec-mode-auto-compaction", {
				enabled: true,
				reason: "handoff-session",
			});
			handoffSession.appendCustomEntry("spec-mode-handoff-pending-start", {
				createdAt: new Date().toISOString(),
			});

			const handoffSessionFile = handoffSession.getSessionFile();
			if (!handoffSessionFile) {
				ctx.ui.notify("Failed to create handoff session.", "error");
				return;
			}

			const result = await ctx.switchSession(handoffSessionFile);
			if (result.cancelled) return;
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle spec mode",
		handler: async (ctx) => toggleSpecMode(ctx),
	});

	pi.on("tool_call", async (event) => {
		if (!specModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Spec mode: command blocked (not allowlisted). Use /spec to disable spec mode first.\nCommand: ${command}`,
			};
		}
	});

	pi.on("context", async (event) => {
		if (specModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "spec-mode-context" || msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[SPEC MODE ACTIVE]") && !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) =>
							c.type === "text" &&
							((c as TextContent).text?.includes("[SPEC MODE ACTIVE]") ||
								(c as TextContent).text?.includes("[PLAN MODE ACTIVE]")),
					);
				}
				return true;
			}),
		};
	});

	pi.on("agent_start", async () => {
		if (executionMode) {
			executionCompletedCountAtAgentStart = todoItems.filter((t) => t.completed).length;
		}
	});

	pi.on("before_agent_start", async () => {
		if (specModeEnabled) {
			return {
				message: {
					customType: "spec-mode-context",
					content: `[SPEC MODE ACTIVE]
You are in spec mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls, questionnaire
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Spec workflow expectations:
- First check for relevant files in docs/briefs/ and treat them as the PRIMARY input.
- If relevant files exist in docs/thinking/, you may consult them as OPTIONAL rationale/history only.
- The pipeline is asymmetric: /think explores reasoning, /shape defines the brief, /spec turns the brief into an implementation spec.
- Do not redo shaping inside /spec when a good brief already exists.
- If a thinking memo and a brief differ, prefer the brief unless the user explicitly says otherwise.
- If no brief exists, you may spec from the direct user request, but keep spec distinct from broad /think reasoning.

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

CRITICAL: You MUST output your spec with a "Spec:" header on its own line followed by numbered steps.
This exact format is REQUIRED for the system to create trackable tasks in the UI:

Spec:
1. First step description
2. Second step description
...

Without a "Spec:" header line, the system CANNOT extract tasks for progress tracking.
Do NOT attempt to make changes - only describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const nextStep = remaining[0];
			const todoList = remaining.map((t) => `${t.step}. ${t.fullText ?? t.text}`).join("\n");
			return {
				message: {
					customType: "spec-execution-context",
					content: `[EXECUTING SPEC - Full tool access enabled]

Remaining steps:
${todoList}

Current step:
${nextStep ? `${nextStep.step}. ${nextStep.fullText ?? nextStep.text}` : "None"}

Execution rules:
- Execute only the current step in this turn.
- When that step is complete, include [DONE:${nextStep?.step ?? "n"}] in your response.
- Do not start later steps in the same turn; the system will automatically continue with the next remaining step.
- If you are blocked, need clarification, or need user approval, stop and explain the blocker.
- Do not emit a [DONE:n] tag unless the corresponding step is actually complete.`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0 && isAssistantMessage(event.message)) {
			const text = getTextContent(event.message);
			if (markCompletedSteps(text, todoItems) > 0) {
				updateStatus(ctx);
			}
			persistState();
		}

		maybeAutoCompactHandoffSession(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "spec-complete", content: `**Spec Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				restoreNormalModeTools();
				updateStatus(ctx);
				persistState();
				return;
			}

			const completedCount = todoItems.filter((t) => t.completed).length;
			const nextStep = todoItems.find((t) => !t.completed);
			if (completedCount > executionCompletedCountAtAgentStart && nextStep) {
				pi.sendUserMessage(
					`Continue spec execution with step ${nextStep.step}: ${nextStep.fullText ?? nextStep.text}. Complete only this step, include [DONE:${nextStep.step}] when finished, and then stop so the system can continue automatically.`,
					{ deliverAs: "followUp" },
				);
			} else if (nextStep) {
				pi.sendMessage(
					{
						customType: "spec-execution-paused",
						content: `**Spec execution paused**\n\nNo completed step was detected for the current turn.\n\nNext remaining step:\n${nextStep.step}. ${nextStep.fullText ?? nextStep.text}\n\nResolve the blocker or send a follow-up instruction to continue.`,
						display: true,
					},
					{ triggerTurn: false },
				);
			}
			return;
		}

		if (!specModeEnabled || !ctx.hasUI) return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "spec-todo-list",
					content: `**Spec Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Spec mode - what next?", [
			todoItems.length > 0 ? "Execute the spec (track progress)" : "Execute the spec",
			"Execute in a new session",
			"Stay in spec mode",
			"Refine the spec",
		]);

		if (choice?.startsWith("Execute the spec")) {
			startExecution(ctx, { deliverAs: "followUp" });
		} else if (choice === "Execute in a new session") {
			// newSession() is only available on ExtensionCommandContext (commands),
			// not on the ExtensionContext we get here in agent_end.
			// Pre-fill the command so the user's next Enter runs it.
			ctx.ui.setEditorText("/spec-handoff");
			ctx.ui.notify('Press Enter to run "/spec-handoff".', "info");
		} else if (choice === "Refine the spec") {
			const refinement = await ctx.ui.editor("Refine the spec:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	pi.events.on(EXCLUSIVE_MODALITY_EVENT, (event: { id?: string; exclusive?: boolean }) => {
		if (!event?.exclusive || event.id === SPEC_MODALITY_ID || (!specModeEnabled && !executionMode) || !latestContext) return;
		disableSpecMode(latestContext, {
			notify: "Spec mode disabled because another modality became active.",
			preserveTodos: true,
		});
	});

	pi.on("session_start", async (_event, ctx) => {
		captureNormalModeTools();
		restoreSessionState(ctx, true);

		const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string }>;
		if (shouldAutoStartHandoffExecution(entries)) {
			scheduleHandoffExecutionStart(ctx);
		}
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreSessionState(ctx, false);
	});
}
