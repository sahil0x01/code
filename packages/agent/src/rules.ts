import type { Sandbox } from "@nullfuse/sandbox";

const FILES = ["AGENTS.md", "CLAUDE.md"];
const MAX_CHARS = 20_000;

/** The instructions a repository gives coding agents, from the files at its root. */
export async function readProjectRules(sandbox: Sandbox) {
	const found: { file: string; text: string }[] = [];
	for (const file of FILES) {
		const result = await sandbox.exec(`if [ -f ${file} ]; then head -c ${MAX_CHARS + 1} ${file}; fi`);
		let text = result.stdout.trim();
		// Often one file is a link to the other, or a copy of it.
		if (result.exitCode !== 0 || !text || found.some((other) => other.text === text)) continue;
		if (text.length > MAX_CHARS) {
			text = `${text.slice(0, MAX_CHARS)}\n[cut: read ${file} for the rest]`;
		}
		found.push({ file, text });
	}
	return found;
}
