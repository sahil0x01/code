import { MAX_OUTPUT_BYTES, type Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { headAndTail } from "../shell";

const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
// The end of a log (the failing test) matters most, so the tail gets two thirds.
const MAX_OUTPUT_CHARS = 30_000;

export function bashTool(sandbox: Sandbox, env?: Record<string, string>) {
	return tool({
		description:
			"Run a shell command in the workspace and return its output and exit code. " +
			"Use it to install dependencies, run tests and builds, and use git. Each call " +
			"is a fresh shell: `cd` and exported variables do not carry over, so pass " +
			"`cwd` or chain commands with &&. Commands must not wait for input. Prefer the " +
			"read, edit, grep and list tools for working with files.",
		inputSchema: z.object({
			command: z.string().min(1).describe("The shell command to run."),
			cwd: z.string().min(1).optional().describe("Directory to run in. Default: the workspace."),
			timeoutSeconds: z
				.number()
				.int()
				.min(1)
				.max(MAX_TIMEOUT_SECONDS)
				.optional()
				.describe(`Default ${DEFAULT_TIMEOUT_SECONDS}, at most ${MAX_TIMEOUT_SECONDS}.`),
		}),
		async execute({ command, cwd, timeoutSeconds }, { abortSignal }) {
			const seconds = timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
			const result = await sandbox.exec(command, {
				cwd,
				env,
				timeoutMs: seconds * 1000,
				signal: abortSignal,
			});

			let output = result.stdout;
			if (result.stderr !== "") {
				output += `${output !== "" && !output.endsWith("\n") ? "\n" : ""}[stderr]\n${result.stderr}`;
			}
			output = headAndTail(output, MAX_OUTPUT_CHARS);

			const notes: string[] = [];
			if (result.truncated) {
				notes.push(`[output was larger than ${MAX_OUTPUT_BYTES} bytes and was cut]`);
			}
			if (result.timedOut) {
				notes.push(
					`[timed out after ${seconds}s: every process in the sandbox was killed, background ones included]`,
				);
			} else if (result.exitCode !== 0) {
				notes.push(`[exit code: ${result.exitCode}]`);
			}

			if (output === "" && notes.length === 0) return "(no output)";
			return [output, ...notes].filter((part) => part !== "").join("\n");
		},
	});
}
