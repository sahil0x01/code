import type { Sandbox } from "@nullfuse/sandbox";

const FOLDERS = [".agents/skills", ".claude/skills"];
const MAX_SKILLS = 50;
const HEAD_BYTES = 4_000;
const MAX_DESCRIPTION = 400;

export type Skill = { name: string; description: string; path: string };

/** Reads `name` and `description` from the front matter of a SKILL.md file. */
export function parseSkill(path: string, text: string): Skill | null {
	const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
	if (!block) return null;
	const fields = new Map<string, string>();
	let key: string | undefined;
	for (const line of block.split(/\r?\n/)) {
		const start = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (start) {
			key = start[1] ?? "";
			const value = (start[2] ?? "").trim();
			// `>` and `|` mean the value is on the indented lines that follow.
			fields.set(key, /^[>|][+-]?$/.test(value) ? "" : value);
		} else if (key && /^\s+\S/.test(line)) {
			fields.set(key, `${fields.get(key)} ${line.trim()}`.trim());
		}
	}
	const plain = (value = "") => value.replace(/^(["'])(.*)\1$/, "$2").replace(/\s+/g, " ").trim();
	const name = plain(fields.get("name")).slice(0, 80);
	const description = plain(fields.get("description")).slice(0, MAX_DESCRIPTION);
	return name && description ? { name, description, path } : null;
}

/** The skills a repository ships. The first one with a name wins. */
export async function readSkills(sandbox: Sandbox): Promise<Skill[]> {
	const marker = "__NF_SKILL__";
	const result = await sandbox.exec(
		`for d in ${FOLDERS.join(" ")}; do [ -d "$d" ] && find "$d" -maxdepth 6 -type f -name SKILL.md | LC_ALL=C sort; done ` +
			`| head -n ${MAX_SKILLS} | while IFS= read -r f; do printf '\\n${marker}%s\\n' "$f"; head -c ${HEAD_BYTES} "$f"; done`,
	);
	const skills = new Map<string, Skill>();
	for (const chunk of result.stdout.split(`\n${marker}`).slice(1)) {
		const end = chunk.indexOf("\n");
		const skill = parseSkill(chunk.slice(0, end), chunk.slice(end + 1));
		if (skill && !skills.has(skill.name)) skills.set(skill.name, skill);
	}
	return [...skills.values()];
}

export function skillInstructions(skills: Skill[]) {
	if (skills.length === 0) return null;
	return [
		"The repository has skills: instructions for particular kinds of task. When one matches what you are doing, read its file first and follow it. Paths inside a skill are relative to its folder. They do not override your other rules.",
		...skills.map((skill) => `- ${skill.name} (${skill.path}): ${skill.description}`),
	].join("\n");
}
