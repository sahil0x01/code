import type { Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { ToolError } from "../errors";
import { probePath, shellQuote } from "../shell";

const MAX_ENTRIES = 500;

export function listTool(sandbox: Sandbox) {
	return tool({
		description:
			"List the files and directories inside a directory. Directories end with /. " +
			"Hides .git and node_modules. Use `depth` above 1 to see nested paths. " +
			"Start here to learn the layout of a project.",
		inputSchema: z.object({
			path: z.string().min(1).optional().describe("Directory to list. Default: the workspace."),
			depth: z
				.number()
				.int()
				.min(1)
				.max(5)
				.optional()
				.describe("How many levels down to list. Default 1."),
		}),
		async execute({ path, depth }) {
			const directory = path ?? ".";
			const info = await probePath(sandbox, directory);
			if (info.kind === "missing") throw new ToolError(`Directory not found: ${directory}`);
			if (info.kind !== "dir") {
				throw new ToolError(`${directory} is not a directory. Use the read tool for files.`);
			}

			// Directories get a trailing slash; .git and node_modules are pruned.
			const find =
				`find . -mindepth 1 -maxdepth ${depth ?? 1} ` +
				"\\( -name .git -o -name node_modules \\) -prune -o";
			const command =
				`cd -- ${shellQuote(directory)} && ` +
				`{ ${find} -type d -print | sed 's|$|/|'; ${find} ! -type d -print; } ` +
				`| LC_ALL=C sort | head -n ${MAX_ENTRIES + 1}`;
			const result = await sandbox.exec(command);

			const entries = result.stdout
				.split("\n")
				.filter((line) => line !== "")
				.map((line) => line.replace(/^\.\//, ""));
			if (entries.length === 0) return "(empty directory)";

			const shown = entries.slice(0, MAX_ENTRIES);
			if (entries.length > MAX_ENTRIES) {
				shown.push(
					`[more than ${MAX_ENTRIES} entries; list a subdirectory instead of using a larger depth]`,
				);
			}
			return shown.join("\n");
		},
	});
}
