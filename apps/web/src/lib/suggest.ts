import { COMMANDS } from "@nullfuse/agent/commands";

export type Token = { kind: "command" | "file"; query: string; start: number };

export type Suggestion = { value: string; hint: string };

const MAX_SHOWN = 8;

/** The command or mention being typed just before the caret, if any. */
export function activeToken(text: string, caret: number): Token | null {
	const before = text.slice(0, caret);
	// Commands only count at the start of a message, possibly after other commands.
	const command = /^\s*(?:\/[\w-]+\s+)*\/([\w-]*)$/.exec(before);
	if (command) return { kind: "command", query: command[1] ?? "", start: caret - (command[1] ?? "").length - 1 };
	const mention = /(?:^|[\s(])@([^\s@]*)$/.exec(before);
	if (mention) return { kind: "file", query: mention[1] ?? "", start: caret - (mention[1] ?? "").length - 1 };
	return null;
}

// Lower is better; null means no match.
function score(path: string, query: string) {
	const full = path.toLowerCase();
	const name = full.replace(/\/$/, "").split("/").at(-1) ?? full;
	if (name.startsWith(query)) return 0;
	if (full.startsWith(query)) return 1;
	if (name.includes(query)) return 2;
	if (full.includes(query)) return 3;
	// The letters in order, as in "cmpsr" for composer.
	let at = 0;
	for (const letter of query) {
		at = full.indexOf(letter, at) + 1;
		if (at === 0) return null;
	}
	return 4;
}

export function suggestFiles(files: readonly string[], query: string): Suggestion[] {
	const wanted = query.toLowerCase();
	return files
		.flatMap((path) => {
			const found = score(path, wanted);
			return found === null ? [] : [{ path, found }];
		})
		.sort((a, b) => a.found - b.found || a.path.length - b.path.length || a.path.localeCompare(b.path))
		.slice(0, MAX_SHOWN)
		.map(({ path }) => ({ value: `@${path}`, hint: path.endsWith("/") ? "Folder" : "" }));
}

// The app carries this one out itself, so the agent never sees it.
export const MERGE_COMMAND = "/merge";

export function suggestCommands(skills: readonly string[], query: string, canMerge = false): Suggestion[] {
	const wanted = query.toLowerCase();
	const known = new Set(COMMANDS.map((command) => command.name));
	return [
		...(canMerge ? [{ value: MERGE_COMMAND, hint: "Merge the pull request, fixing what blocks it first" }] : []),
		...COMMANDS.map((command) => ({ value: `/${command.name}`, hint: command.hint })),
		...skills.filter((name) => !known.has(name)).map((name) => ({ value: `/${name}`, hint: "Skill in this repository" })),
	].filter((entry) => entry.value.slice(1).toLowerCase().startsWith(wanted));
}

/** Puts the choice in place of what was typed, ready for the next word. */
export function applySuggestion(text: string, token: Token, caret: number, value: string) {
	const rest = text.slice(caret).replace(/^[ \t]/, "");
	const head = `${text.slice(0, token.start)}${value} `;
	return { text: head + rest, caret: head.length };
}
