import { MAX_OUTPUT_BYTES, readText, type Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { ToolError } from "../errors";
import { createFileLock, type FileLock } from "./file-lock";
import { pluralize, probePath } from "../shell";

const CONTEXT_LINES = 3;

export function editTool(sandbox: Sandbox, lock: FileLock = createFileLock(sandbox.workdir)) {
	return tool({
		description:
			"Replace text in an existing file. `oldString` must match the file exactly, " +
			"including whitespace and indentation, and must appear only once unless " +
			"`replaceAll` is true. Include a few surrounding lines in `oldString` to make " +
			"it unique. Read the file first so you copy the text exactly.",
		inputSchema: z.object({
			path: z.string().min(1).describe("File path, relative to the workspace or absolute."),
			oldString: z.string().min(1).describe("The exact text to replace."),
			newString: z.string().describe("The text to put in its place. May be empty to delete."),
			replaceAll: z
				.boolean()
				.optional()
				.describe("Replace every occurrence instead of requiring exactly one."),
		}),
		execute: ({ path, oldString, newString, replaceAll }) =>
			lock(path, async () => {
				if (oldString === newString) {
					throw new ToolError("oldString and newString are identical, so nothing would change.");
				}

				const info = await probePath(sandbox, path);
				if (info.kind === "missing") {
					throw new ToolError(`File not found: ${path}. Use the write tool to create it.`);
				}
				if (info.kind !== "file") throw new ToolError(`${path} is not a regular file.`);
				if (info.size > MAX_OUTPUT_BYTES) {
					throw new ToolError(`${path} is too large to edit with this tool (${info.size} bytes).`);
				}

				const text = await readText(sandbox, path);
				const count = text.split(oldString).length - 1;
				if (count === 0) {
					throw new ToolError(
						`oldString was not found in ${path}. It must match exactly, including ` +
							"whitespace and indentation. Use the read tool to see the current content.",
					);
				}
				if (count > 1 && !replaceAll) {
					throw new ToolError(
						`oldString appears ${count} times in ${path}. Add surrounding lines to make it ` +
							"unique, or set replaceAll to true to change every occurrence.",
					);
				}

				// Not String.replace: it would read `$&` or `$1` in newString as patterns.
				const at = text.indexOf(oldString);
				const updated = replaceAll
					? text.split(oldString).join(newString)
					: text.slice(0, at) + newString + text.slice(at + oldString.length);
				await sandbox.writeFile(path, updated);

				const firstLine = updated.slice(0, at).split("\n").length;
				const changedLines = newString.split("\n").length;
				const rows = updated.split("\n");
				const from = Math.max(1, firstLine - CONTEXT_LINES);
				const to = Math.min(rows.length, firstLine + changedLines - 1 + CONTEXT_LINES);
				const snippet = rows
					.slice(from - 1, to)
					.map((row, index) => `${String(from + index).padStart(6)}\t${row}`)
					.join("\n");

				return `Edited ${path}: replaced ${pluralize(replaceAll ? count : 1, "occurrence")}.\n${snippet}`;
			}),
	});
}
