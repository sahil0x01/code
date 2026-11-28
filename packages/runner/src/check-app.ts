import { imageShelf, ToolError } from "@nullfuse/agent";
import type { Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { parseResult, runHarness } from "./recording";

const MAX_SNAPSHOT_CHARS = 8000;

export type AppUnderTest = {
	startCommand: string;
	port: number;
	env?: Record<string, string>;
};

const list = (title: string, items: unknown) =>
	Array.isArray(items) && items.length > 0
		? `${title}:\n${items.slice(0, 20).map((item) => `- ${String(item).slice(0, 500)}`).join("\n")}`
		: `${title}: none`;

function report(result: Record<string, unknown>) {
	const snapshot = String(result.snapshot ?? "");
	return [
		`Opened ${String(result.url).slice(0, 500)}. ${
			result.passed ? "No script failure." : `The script failed: ${String(result.error).slice(0, 2000)}`
		}`,
		list("Console errors and warnings", result.console),
		list("Failed requests", result.network),
		`Page content (${result.picture ? "the text structure; a screenshot follows" : "text structure only, not how it looks"}):\n${
			snapshot.length > MAX_SNAPSHOT_CHARS ? `${snapshot.slice(0, MAX_SNAPSHOT_CHARS)}\n[cut]` : snapshot || "(empty)"
		}`,
	].join("\n\n");
}

/** Lets the agent run the web app in a real browser and see what happens. */
export function checkAppTool(sandbox: Sandbox, app: AppUnderTest, options: { images?: boolean } = {}) {
	const pictures = imageShelf();
	return tool({
		description:
			`Start the web app (\`${app.startCommand}\`, port ${app.port}), open it in a real browser and ` +
			"report the page content, console errors and failed requests. The app is started fresh " +
			"and stopped afterwards, so do not start it yourself. Use it to confirm that a visible " +
			"change works. Pass `script` to click and type before the report." +
			(options.images ? " A screenshot of the final page comes with it, so check how it looks too." : ""),
		toModelOutput: ({ toolCallId, output }) => pictures.show(toolCallId, String(output)),
		inputSchema: z.object({
			path: z.string().startsWith("/").max(2000).optional().describe("Page to open without a script. Default /."),
			script: z
				.string()
				.max(20_000)
				.optional()
				.describe(
					'An ES module, without imports: export default async ({ page, expect }) => { await page.goto("/"); ... }',
				),
		}),
		async execute({ path, script }, { abortSignal, toolCallId }) {
			const run = await runHarness(sandbox, {
				...app,
				mode: "check",
				path,
				script,
				picture: options.images,
				signal: abortSignal,
			});
			if (run.ok) {
				let result: Record<string, unknown>;
				try {
					result = Object(JSON.parse(run.text));
				} catch {
					throw new ToolError("The app check returned no readable result.");
				}
				if (result.status === "checked") {
					const text = report(result);
					if (result.picture !== "check.jpg") return text;
					// The report still helps when the picture cannot be read.
					const bytes = await sandbox.readFile(`${run.outDir}/check.jpg`).catch(() => null);
					return bytes ? pictures.keep(toolCallId, bytes, "image/jpeg", text) : text;
				}
			}
			const skipped = run.ok ? parseResult(run.text, "") : run.skipped;
			if (skipped.status !== "skipped") throw new ToolError("The app check returned no result.");
			const hint =
				skipped.reason === "port_in_use" ? " Stop the server you started on that port, then try again." : "";
			throw new ToolError(`${skipped.message}${hint}${skipped.detail ? `\n${skipped.detail}` : ""}`);
		},
	});
}
