import { mkdirSync, writeFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const MermaidParams = Type.Object({
	diagram: Type.String({ description: "Mermaid diagram source code" }),
	format: Type.Optional(
		Type.Union([Type.Literal("svg"), Type.Literal("png")], {
			description: "Output image format (default: svg)",
		}),
	),
	saveTo: Type.Optional(
		Type.String({
			description: "Optional output file path to save rendered image (e.g. /tmp/graph.svg)",
		}),
	),
});

type MermaidParamsType = {
	diagram: string;
	format?: "svg" | "png";
	saveTo?: string;
};

function resolveOutputPath(saveTo: string, cwd: string): string {
	return isAbsolute(saveTo) ? saveTo : resolve(cwd, saveTo);
}

export default function mermaidTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "mermaid",
		label: "Mermaid",
		description: "Render Mermaid diagrams to SVG or PNG so they can be viewed inline.",
		parameters: MermaidParams,

		async execute(_toolCallId, params: MermaidParamsType, signal, _onUpdate, ctx) {
			const format = params.format ?? "svg";
			const endpoint = `https://kroki.io/mermaid/${format}`;

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 20_000);

			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			try {
				const response = await fetch(endpoint, {
					method: "POST",
					headers: { "Content-Type": "text/plain" },
					body: params.diagram,
					signal: controller.signal,
				});

				if (!response.ok) {
					const body = await response.text().catch(() => "");
					return {
						content: [
							{
								type: "text" as const,
								text: `Failed to render Mermaid (${response.status}): ${body || response.statusText}`,
							},
						],
						details: { ok: false, format },
						isError: true,
					};
				}

				const bytes = new Uint8Array(await response.arrayBuffer());
				const base64 = Buffer.from(bytes).toString("base64");
				const mimeType = format === "svg" ? "image/svg+xml" : "image/png";

				let savedPath: string | undefined;
				if (params.saveTo) {
					savedPath = resolveOutputPath(params.saveTo, ctx.cwd);
					mkdirSync(dirname(savedPath), { recursive: true });
					writeFileSync(savedPath, Buffer.from(bytes));
				}

				const text = savedPath
					? `Rendered Mermaid (${format.toUpperCase()}) and saved to ${savedPath}`
					: `Rendered Mermaid (${format.toUpperCase()})`;

				return {
					content: [
						{ type: "text" as const, text },
						{ type: "image" as const, data: base64, mimeType },
					],
					details: { ok: true, format, savedPath },
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					content: [{ type: "text" as const, text: `Failed to render Mermaid: ${message}` }],
					details: { ok: false, format },
					isError: true,
				};
			} finally {
				clearTimeout(timeout);
			}
		},

		renderCall(args: MermaidParamsType, theme) {
			const format = args.format ?? "svg";
			const lines = args.diagram.split("\n").length;
			const saveHint = args.saveTo ? ` → ${args.saveTo}` : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("mermaid"))} ${theme.fg("accent", format)} ${theme.fg("muted", `(${lines} lines${saveHint})`)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const textContent = result.content.find((c) => c.type === "text");
			if (!textContent || textContent.type !== "text") {
				return new Text("", 0, 0);
			}
			const color = result.isError ? "error" : "success";
			return new Text(theme.fg(color, textContent.text), 0, 0);
		},
	});
}
