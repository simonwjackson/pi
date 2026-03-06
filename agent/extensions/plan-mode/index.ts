/**
 * Plan Mode Extension
 *
 * Read-only exploration mode for safe code analysis.
 * When enabled, only read-only tools are available.
 *
 * Features:
 * - /plan command or Ctrl+Alt+P to toggle
 * - Bash restricted to allowlisted read-only commands
 * - Extracts numbered plan steps from "Plan:" sections
 * - [DONE:n] markers to complete steps during execution
 * - Progress tracking widget during execution
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

// Tools
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const HANDOFF_AUTO_COMPACT_RESERVE_TOKENS = 16384;
const HANDOFF_AUTO_COMPACT_PERCENT = 0.85;
const HANDOFF_AUTO_COMPACT_INSTRUCTIONS = `Preserve the handed-off plan context, including:
- the original request
- the planning output and rationale
- the extracted tasks / remaining steps
- implementation progress and decisions made so far
- any blockers, open questions, or follow-up work

Keep the summary actionable for continuing plan execution in this session.`;

// Type guard for assistant messages
function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

// Extract text content from an assistant message
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

interface PlanContextSnapshot {
	request?: string;
	response?: string;
}

function getLatestPlanContext(messages: AgentMessage[]): PlanContextSnapshot | undefined {
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

export default function planModeExtension(pi: ExtensionAPI): void {
	let planModeEnabled = false;
	let executionMode = false;
	let todoItems: TodoItem[] = [];
	let handoffAutoCompactionEnabled = false;
	let handoffAutoCompactionInFlight = false;

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only exploration)",
		type: "boolean",
		default: false,
	});

	function updateStatus(ctx: ExtensionContext): void {
		// Footer status
		if (executionMode && todoItems.length > 0) {
			const completed = todoItems.filter((t) => t.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
		} else if (planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
		} else {
			ctx.ui.setStatus("plan-mode", undefined);
		}

		// Widget showing todo list
		if (executionMode && todoItems.length > 0) {
			const lines = todoItems.map((item) => {
				if (item.completed) {
					return (
						ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
					);
				}
				return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
			});
			ctx.ui.setWidget("plan-todos", lines);
		} else {
			ctx.ui.setWidget("plan-todos", undefined);
		}
	}

	function togglePlanMode(ctx: ExtensionContext): void {
		planModeEnabled = !planModeEnabled;
		executionMode = false;
		todoItems = [];

		if (planModeEnabled) {
			pi.setActiveTools(PLAN_MODE_TOOLS);
			ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
		} else {
			pi.setActiveTools(NORMAL_MODE_TOOLS);
			ctx.ui.notify("Plan mode disabled. Full access restored.");
		}
		updateStatus(ctx);
	}

	function persistState(): void {
		pi.appendEntry("plan-mode", {
			enabled: planModeEnabled,
			todos: todoItems,
			executing: executionMode,
		});
	}

	function restoreSessionState(ctx: ExtensionContext, includePlanFlag = false): void {
		planModeEnabled = includePlanFlag && pi.getFlag("plan") === true;
		executionMode = false;
		todoItems = [];
		handoffAutoCompactionEnabled = false;
		handoffAutoCompactionInFlight = false;

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
		}

		const autoCompactionEntry = entries
			.filter(
				(e: { type: string; customType?: string }) =>
					e.type === "custom" && e.customType === "plan-mode-auto-compaction",
			)
			.pop() as { data?: { enabled?: boolean } } | undefined;
		handoffAutoCompactionEnabled = autoCompactionEntry?.data?.enabled === true;

		// On resume: re-scan messages to rebuild completion state
		// Only scan messages AFTER the last "plan-mode-execute" to avoid picking up [DONE:n] from previous plans
		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
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

		pi.setActiveTools(planModeEnabled ? PLAN_MODE_TOOLS : NORMAL_MODE_TOOLS);
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

	function startExecution(ctx: ExtensionContext): void {
		planModeEnabled = false;
		executionMode = todoItems.length > 0;
		pi.setActiveTools(NORMAL_MODE_TOOLS);
		updateStatus(ctx);
		persistState();

		const execMessage =
			todoItems.length > 0
				? `Execute the plan. Start with step 1: ${todoItems[0].text}`
				: "Execute the plan you just created.";

		// Use a user message, not a custom message, so the normal prompt pipeline runs
		// and before_agent_start can inject the full execution context.
		pi.sendUserMessage(execMessage);
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode, or run a planning request in plan mode with optional input",
		handler: async (args, ctx) => {
			const input = args?.trim();
			if (!input) {
				togglePlanMode(ctx);
				return;
			}

			if (!planModeEnabled) {
				togglePlanMode(ctx);
			} else if (executionMode) {
				executionMode = false;
				pi.setActiveTools(PLAN_MODE_TOOLS);
				updateStatus(ctx);
				persistState();
			}

			pi.sendUserMessage(input);
		},
	});

	pi.registerCommand("todos", {
		description: "Show current plan todo list",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("No todos. Create a plan first with /plan", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`Plan Progress:\n${list}`, "info");
		},
	});

	pi.registerCommand("plan-exec-new", {
		description: "Execute the current plan in a new session",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			if (todoItems.length === 0 && !planModeEnabled) {
				ctx.ui.notify("No active plan to execute. Use /plan first.", "warning");
				return;
			}

			const todosSnapshot = todoItems.map((item) => ({ ...item }));
			const branchMessages = ctx.sessionManager
				.getBranch()
				.filter((entry): entry is { type: "message"; message: AgentMessage } => entry.type === "message")
				.map((entry) => entry.message);
			const planContext = getLatestPlanContext(branchMessages);
			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				parentSession,
				setup: async (sessionManager) => {
					const sections = ["[PLAN HANDOFF FROM PARENT SESSION]"];

					if (planContext?.request?.trim()) {
						sections.push(`Original request:\n${planContext.request.trim()}`);
					}

					if (planContext?.response?.trim()) {
						sections.push(`Planning output:\n${planContext.response.trim()}`);
					}

					if (todosSnapshot.length > 0) {
						const planText = todosSnapshot.map((item) => `${item.step}. ${item.text}`).join("\n");
						sections.push(`Extracted tasks:\n${planText}`);
					}

					sessionManager.appendCustomMessageEntry("plan-mode-handoff", sections.join("\n\n"), true, {
						todos: todosSnapshot,
						planContext,
					});
					sessionManager.appendCustomEntry("plan-mode-auto-compaction", {
						enabled: true,
						reason: "handoff-session",
					});
				},
			});
			if (result.cancelled) return;

			handoffAutoCompactionEnabled = true;
			handoffAutoCompactionInFlight = false;
			todoItems = todosSnapshot;
			startExecution(ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "Toggle plan mode",
		handler: async (ctx) => togglePlanMode(ctx),
	});

	// Block destructive bash commands in plan mode
	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;

		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	// Filter out stale plan mode context when not in plan mode
	pi.on("context", async (event) => {
		if (planModeEnabled) return;

		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;

				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	// Inject plan/execution context before agent starts
	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- You can only use: read, bash, grep, find, ls, questionnaire
- You CANNOT use: edit, write (file modifications are disabled)
- Bash is restricted to an allowlist of read-only commands

Ask clarifying questions using the questionnaire tool.
Use brave-search skill via bash for web research.

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	// Track progress after each turn
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

	// Handle plan completion and plan mode UI
	pi.on("agent_end", async (event, ctx) => {
		// Check if execution is complete
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				pi.setActiveTools(NORMAL_MODE_TOOLS);
				updateStatus(ctx);
				persistState(); // Save cleared state so resume doesn't restore old execution mode
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		// Extract todos from last assistant message
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}

		// Show plan steps and prompt for next action
		if (todoItems.length > 0) {
			const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
			pi.sendMessage(
				{
					customType: "plan-todo-list",
					content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
					display: true,
				},
				{ triggerTurn: false },
			);
		}

		const choice = await ctx.ui.select("Plan mode - what next?", [
			todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
			"Execute in a new session",
			"Stay in plan mode",
			"Refine the plan",
		]);

		if (choice?.startsWith("Execute the plan")) {
			startExecution(ctx);
		} else if (choice === "Execute in a new session") {
			// pi.sendUserMessage() bypasses extension command handling, so sending
			// "/plan-exec-new" here would go to the LLM as a normal user message.
			// Pre-fill the command instead so the user's next Enter runs the command.
			ctx.ui.setEditorText("/plan-exec-new");
			ctx.ui.notify('Ready: press Enter to run "/plan-exec-new".', "info");
		} else if (choice === "Refine the plan") {
			const refinement = await ctx.ui.editor("Refine the plan:", "");
			if (refinement?.trim()) {
				pi.sendUserMessage(refinement.trim());
			}
		}
	});

	// Restore state on session start/resume
	pi.on("session_start", async (_event, ctx) => {
		restoreSessionState(ctx, true);
	});

	pi.on("session_switch", async (_event, ctx) => {
		restoreSessionState(ctx, false);
	});
}
