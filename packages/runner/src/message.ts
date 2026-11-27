import { foldersAbove, shellQuote, type Skill } from "@nullfuse/agent";
import { parseMentions, parseMessage } from "@nullfuse/agent/commands";
import type { Sandbox } from "@nullfuse/sandbox";

const MAX_FILE_CHARS = 20_000;
const MAX_TOTAL_CHARS = 60_000;
const MAX_ENTRIES = 200;

const folderOf = (path: string) => path.split("/").at(-2) ?? "";

/** Every name a skill can be called by: its own and its folder's. */
export const skillNames = (skills: Skill[]) => skills.flatMap((skill) => [skill.name, folderOf(skill.path)]);

/** The files and folders a message points at, read from the workspace. */
async function attachments(sandbox: Sandbox, content: string) {
	const blocks: string[] = [];
	const folders = new Set<string>();
	let size = 0;
	const add = (tag: string, path: string, text: string) => {
		const room = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - size);
		if (room <= 0) return;
		const shown = text.length > room ? `${text.slice(0, room)}\n[cut: read ${path} for the rest]` : text;
		size += shown.length;
		blocks.push(`<${tag} path="${path}">\n${shown}\n</${tag}>`);
	};

	for (const mention of parseMentions(content)) {
		const path = mention.replace(/\/+$/, "");
		const quoted = shellQuote(`./${path}`);
		const found = await sandbox.exec(
			`if [ -f ${quoted} ]; then echo file; head -c ${MAX_FILE_CHARS + 1} ${quoted}; ` +
				`elif [ -d ${quoted} ]; then echo dir; ls -1Ap ${quoted} | head -n ${MAX_ENTRIES}; fi`,
		);
		const end = found.stdout.indexOf("\n");
		const kind = found.stdout.slice(0, end);
		const text = found.stdout.slice(end + 1);
		if (kind === "dir") add("folder", path, text.trim());
		if (kind !== "file" || text.includes("\0")) continue;
		add("file", path, text);
		// Reading a file this way must bring its folders' instructions, as the read tool does.
		for (const folder of foldersAbove(sandbox.workdir, path)) folders.add(folder);
	}

	for (const folder of folders) {
		const file = shellQuote(`./${folder}/AGENTS.md`);
		const rules = await sandbox.exec(`if [ -f ${file} ]; then head -c ${MAX_FILE_CHARS} ${file}; fi`);
		if (rules.stdout.trim()) add("instructions", `${folder}/AGENTS.md`, rules.stdout.trim());
	}
	return blocks;
}

/** What the model is given for the message being answered: commands spelled out, files attached. */
export async function expandMessage(sandbox: Sandbox, content: string, skills: Skill[]) {
	const parsed = parseMessage(content, skillNames(skills));
	const lines = parsed.commands.flatMap((command) => command.prompt ?? []);
	for (const name of parsed.skills) {
		const skill = skills.find((s) => s.name === name || folderOf(s.path) === name);
		if (skill) lines.push(`Use the skill "${skill.name}": read ${skill.path} first and follow it.`);
	}
	if (parsed.rest) lines.push(parsed.rest);
	const attached = await attachments(sandbox, parsed.rest);
	if (attached.length > 0) {
		lines.push("The message points at these, shown as they are now:", ...attached);
	}
	return lines.length > 0 ? lines.join("\n\n") : content;
}
