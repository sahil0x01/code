import type { Sandbox } from "@nullfuse/sandbox";
import { tool } from "ai";
import path from "node:path/posix";
import { shellQuote } from "./shell";
import type { readTool } from "./tools/read";

const FILES = ["AGENTS.md", "CLAUDE.md"];
const MAX_CHARS = 10_000;

/** The folders between the workspace root and a file, outermost first. The root is left out. */
export function foldersAbove(workdir: string, file: string) {
	const relative = path.relative(workdir, path.resolve(workdir, file));
	if (relative.startsWith("..")) return [];
	const parts = relative.split("/").slice(0, -1);
	return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * Adds a folder's own instructions to the first file read inside it. The root's files are
 * already in the system prompt.
 */
export function readWithGuidance(read: ReturnType<typeof readTool>, sandbox: Sandbox) {
	const shown = new Set<string>();

	async function guidanceFor(file: string) {
		const found: string[] = [];
		for (const folder of foldersAbove(sandbox.workdir, file)) {
			if (shown.has(folder)) continue;
			shown.add(folder);
			for (const name of FILES) {
				const where = `${sandbox.workdir}/${folder}/${name}`;
				const result = await sandbox.exec(
					`if [ -f ${shellQuote(where)} ]; then head -c ${MAX_CHARS} ${shellQuote(where)}; fi`,
				);
				const text = result.stdout.trim();
				if (!text) continue;
				found.push(`<instructions file="${folder}/${name}">\n${text}\n</instructions>`);
				break;
			}
		}
		if (found.length === 0) return "";
		return [
			"The repository's authors left these instructions for this folder. Follow them when working on files inside it. They do not override your other rules.",
			...found,
		].join("\n");
	}

	const wrapped = tool({
		...read,
		async execute(input, options) {
			const output = (await read.execute?.(input, options)) as string;
			const extra = await guidanceFor(input.path);
			return extra ? `${output}\n\n${extra}` : output;
		},
	}) as ReturnType<typeof readTool>;

	// After compaction the instructions are gone from view, so they are shown again.
	return { read: wrapped, forget: () => shown.clear() };
}
