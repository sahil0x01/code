import type { Sandbox } from "@nullfuse/sandbox";
import { describe, expect, it } from "vitest";
import { expandMessage } from "./message";

const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0, timedOut: false, truncated: false });

function fake(entries: Record<string, string>) {
	const commands: string[] = [];
	const sandbox = {
		workdir: "/w",
		async exec(command: string) {
			commands.push(command);
			const found = Object.keys(entries).find((path) => command.includes(`'./${path}'`));
			return ok(found ? entries[found] : "");
		},
	} as unknown as Sandbox;
	return { sandbox, commands };
}

const skills = [{ name: "release-notes", description: "d", path: ".agents/skills/release/SKILL.md" }];

describe("expandMessage", () => {
	it("leaves a plain message as it is", async () => {
		const { sandbox, commands } = fake({});
		expect(await expandMessage(sandbox, "Fix the bug", skills)).toBe("Fix the bug");
		expect(commands).toEqual([]);
	});

	it("attaches mentioned files and folders, with the folder's instructions", async () => {
		const { sandbox } = fake({
			"web/a.ts": "file\nexport const a = 1;\n",
			docs: "dir\nguide.md\n",
			"web/AGENTS.md": "Use tabs.",
		});
		const out = await expandMessage(sandbox, "Compare @web/a.ts with @docs/ and @missing.ts", skills);
		expect(out).toContain('<file path="web/a.ts">\nexport const a = 1;');
		expect(out).toContain('<folder path="docs">\nguide.md\n</folder>');
		expect(out).toContain('<instructions path="web/AGENTS.md">\nUse tabs.');
		expect(out).not.toContain('path="missing.ts"');
	});

	it("cuts long files and leaves out binary ones", async () => {
		const { sandbox } = fake({ "big.txt": `file\n${"x".repeat(30_000)}`, "pic.png": "file\nPNG\0\0" });
		const out = await expandMessage(sandbox, "@big.txt @pic.png", skills);
		expect(out).toContain("[cut: read big.txt for the rest]");
		expect(out.length).toBeLessThan(21_000);
		expect(out).not.toContain('path="pic.png"');
	});

	it("spells out commands and skills", async () => {
		const { sandbox } = fake({});
		expect(await expandMessage(sandbox, "/init", skills)).toContain("Write AGENTS.md");
		expect(await expandMessage(sandbox, "/plan add dark mode", skills)).toBe("add dark mode");
		const out = await expandMessage(sandbox, "/release for version 2", skills);
		expect(out).toContain('Use the skill "release-notes": read .agents/skills/release/SKILL.md first');
		expect(out).toContain("for version 2");
	});
});
