import { MAX_OUTPUT_BYTES, type Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import { z } from "zod";
import { ToolError } from "../errors";
import { imageShelf } from "../image-shelf";
import { pluralize, probePath } from "../shell";

const DEFAULT_LIMIT = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_OUTPUT_CHARS = 100_000;

const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
};

export function readTool(sandbox: Sandbox, options: { images?: boolean } = {}) {
	const images = imageShelf();
	return tool({
		description:
			"Read a text file. Returns the lines numbered, like `cat -n`. Long files are " +
			"returned in parts: use `offset` (first line, starting at 1) and `limit` " +
			"(number of lines) to read further. Use this before editing a file." +
			(options.images ? " Reading a PNG, JPEG, GIF or WebP file shows you the picture." : ""),
		inputSchema: z.object({
			path: z.string().min(1).describe("File path, relative to the workspace or absolute."),
			offset: z.number().int().min(1).optional().describe("First line to return. Default 1."),
			limit: z
				.number()
				.int()
				.min(1)
				.max(5000)
				.optional()
				.describe(`Number of lines to return. Default ${DEFAULT_LIMIT}.`),
		}),
		toModelOutput: ({ toolCallId, output }) => images.show(toolCallId, String(output)),
		async execute({ path, offset, limit }, { toolCallId }) {
			const info = await probePath(sandbox, path);
			if (info.kind === "missing") throw new ToolError(`File not found: ${path}`);
			if (info.kind === "dir") {
				throw new ToolError(`${path} is a directory. Use the list tool to see its contents.`);
			}
			if (info.kind === "other") throw new ToolError(`${path} is not a regular file.`);
			if (info.size > MAX_OUTPUT_BYTES) {
				throw new ToolError(
					`${path} is ${info.size} bytes, too large to read whole. ` +
						"Use grep to find what you need, or bash with head, tail or sed -n 'START,ENDp'.",
				);
			}

			const bytes = await sandbox.readFile(path);
			const type = IMAGE_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
			if (options.images && type) {
				return images.keep(toolCallId, bytes, type, `Image ${path} (${type}, ${info.size} bytes)`);
			}
			if (bytes.subarray(0, 8000).includes(0)) {
				throw new ToolError(`${path} looks like a binary file, so it cannot be shown as text.`);
			}

			const text = new TextDecoder().decode(bytes);
			if (text === "") return "(empty file)";

			const lines = text.split("\n");
			if (text.endsWith("\n")) lines.pop();

			const first = (offset ?? 1) - 1;
			if (first >= lines.length) {
				throw new ToolError(
					`offset ${offset} is past the end of ${path}, which has ${pluralize(lines.length, "line")}.`,
				);
			}

			const shown: string[] = [];
			let size = 0;
			for (const [index, line] of lines.slice(first, first + (limit ?? DEFAULT_LIMIT)).entries()) {
				const clipped =
					line.length > MAX_LINE_CHARS
						? `${line.slice(0, MAX_LINE_CHARS)} [line cut at ${MAX_LINE_CHARS} characters]`
						: line;
				const row = `${String(first + index + 1).padStart(6)}\t${clipped}`;
				if (size + row.length > MAX_OUTPUT_CHARS && shown.length > 0) break;
				shown.push(row);
				size += row.length + 1;
			}

			const last = first + shown.length;
			if (last < lines.length) {
				shown.push(
					`[showing lines ${first + 1}-${last} of ${lines.length}; call read again with offset ${last + 1} to continue]`,
				);
			}
			return shown.join("\n");
		},
	});
}
