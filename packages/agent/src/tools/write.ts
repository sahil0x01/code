import type { Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { ToolError } from "../errors";
import { pluralize, probePath } from "../shell";

const MAX_CONTENT_CHARS = 500_000;

export function writeTool(sandbox: Sandbox) {
	return tool({
		description:
			"Create a file with the given content, or replace an existing file completely. " +
			"Missing parent directories are created. To change part of an existing file, " +
			"use edit instead: it is safer and cheaper.",
		inputSchema: z.object({
			path: z.string().min(1).describe("File path, relative to the workspace or absolute."),
			content: z
				.string()
				.max(MAX_CONTENT_CHARS)
				.describe("The complete new content of the file."),
		}),
		async execute({ path, content }) {
			const info = await probePath(sandbox, path);
			if (info.kind === "dir") throw new ToolError(`${path} is a directory.`);
			if (info.kind === "other") throw new ToolError(`${path} is not a regular file.`);

			await sandbox.writeFile(path, content);

			const lines =
				content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
			const bytes = new TextEncoder().encode(content).length;
			return `${info.kind === "file" ? "Overwrote" : "Created"} ${path} (${pluralize(lines, "line")}, ${pluralize(bytes, "byte")}).`;
		},
	});
}
