import type { Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { ToolError } from "../errors";
import { pluralize, shellQuote } from "../shell";

const MAX_MATCHES = 200;
const MAX_LINE_CHARS = 500;

export function grepTool(sandbox: Sandbox) {
	return tool({
		description:
			"Search file contents with a regular expression (POSIX extended syntax: use " +
			"[0-9] rather than \\d). Returns `path:line:text` for each match. Skips " +
			".git, node_modules and binary files. Use it to find where something is " +
			"defined or used before reading whole files.",
		inputSchema: z.object({
			pattern: z.string().min(1).describe("Regular expression to search for."),
			path: z
				.string()
				.min(1)
				.optional()
				.describe("Directory or file to search. Default: the workspace."),
			include: z
				.string()
				.min(1)
				.optional()
				.describe("Only search files whose name matches this glob, for example *.ts."),
			ignoreCase: z.boolean().optional(),
		}),
		async execute({ pattern, path, include, ignoreCase }) {
			const start = path ?? ".";
			// find + xargs instead of grep -r: --include and --exclude-dir are GNU-only.
			const command = [
				`find ${shellQuote(start.startsWith("-") ? `./${start}` : start)}`,
				"\\( -name .git -o -name node_modules \\) -prune -o",
				`-type f ${include ? `-name ${shellQuote(include)} ` : ""}-print0`,
				"| xargs -0 -r grep -nHIE",
				ignoreCase ? "-i" : "",
				`-e ${shellQuote(pattern)} --`,
			]
				.filter(Boolean)
				.join(" ");

			const result = await sandbox.exec(command);

			if (result.stdout === "") {
				const error = result.stderr.trim();
				if (error !== "") throw new ToolError(`grep failed: ${error}`);
				return "No matches.";
			}

			const lines = result.stdout.split("\n").filter((line) => line !== "");
			const shown = lines
				.slice(0, MAX_MATCHES)
				.map((line) =>
					line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)} [cut]` : line,
				);

			if (lines.length > MAX_MATCHES || result.truncated) {
				shown.push(
					`[showing the first ${pluralize(MAX_MATCHES, "match")}; there are more. Narrow the pattern, path or include.]`,
				);
			}
			return shown.join("\n");
		},
	});
}
