// No imports, so browser code can use this file.

export type Command = {
	name: string;
	hint: string;
	/** An option of the run that the command turns on. */
	sets?: "planOnly" | "verify";
	/** The turn can only read. */
	readOnly?: boolean;
	/** What the model is told in place of the command. */
	prompt?: string;
};

export const COMMANDS: readonly Command[] = [
	{ name: "plan", hint: "Plan first: nothing changes until you approve", sets: "planOnly" },
	{ name: "test", hint: "Run the tests afterwards", sets: "verify" },
	{
		name: "ask",
		hint: "Ask about the code without changing it",
		readOnly: true,
		prompt: "Answer this from the code. Do not propose changes unless asked.",
	},
	{
		name: "review",
		hint: "Review what this chat has changed",
		readOnly: true,
		prompt:
			"Call the task tool with kind review to review everything this branch changes compared with its base branch, saying what was asked for in this chat. Check its findings against the code, then report the real problems, most serious first. Change nothing.",
	},
	{
		name: "init",
		hint: "Write or update the repository's AGENTS.md",
		prompt:
			"Write AGENTS.md at the root of the repository, or update it if there is one. Record how to set up, build, test and run the project, how the code is laid out, and conventions that are not obvious. Check each command by running it. Keep it short, and do not invent anything.",
	},
];

const LEADING = /^\s*\/([A-Za-z0-9][\w-]*)(?=\s|$)/;

/**
 * The commands a message starts with, and the text after them. A name that is not a
 * command may be one of the repository's skills; `skills` lists those that exist.
 */
export function parseMessage(content: string, skills: readonly string[] = []) {
	const commands: Command[] = [];
	const used: string[] = [];
	let rest = content;
	for (;;) {
		const name = LEADING.exec(rest)?.[1];
		if (name === undefined) break;
		const command = COMMANDS.find((known) => known.name === name);
		if (command) commands.push(command);
		else if (skills.includes(name)) used.push(name);
		else break;
		rest = rest.replace(LEADING, "");
	}
	return { commands, skills: used, rest: rest.trim() };
}

/** The run options a message's commands turn on. */
export function commandOptions(content: string) {
	const { commands, rest } = parseMessage(content);
	const set = (option: Command["sets"]) => commands.some((command) => command.sets === option);
	return {
		planOnly: set("planOnly"),
		verify: set("verify"),
		/** The command only changes how a task runs, and no task was given. */
		missingTask: rest === "" && commands.length > 0 && commands.every((command) => command.sets !== undefined),
	};
}

export const MAX_MENTIONS = 10;

/** The paths a message points at with `@`. They may not exist. */
export function parseMentions(content: string) {
	const found = [...content.matchAll(/(?:^|[\s(])@([^\s@]+)/g)]
		.map((match) => (match[1] ?? "").replace(/[.,;:!?)\]}"'`]+$/, ""))
		.filter((path) => path !== "" && !path.startsWith("/") && !path.split("/").includes(".."));
	return [...new Set(found)].slice(0, MAX_MENTIONS);
}
