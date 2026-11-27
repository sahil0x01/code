import { MockLanguageModelV4 } from "ai/test";
import type { Sandbox } from "@nullfuse/sandbox";
import { describe, expect, it } from "vitest";
import { type AgentStep, runAgent } from "./agent";
import { compactionThreshold, transcript } from "./compact";
import { foldersAbove } from "./guidance";
import { parseSkill, readSkills, skillInstructions } from "./skills";
import { answer, toolCalls, usage } from "./testing";

/** A sandbox that answers the commands these features run. */
function fake(files: Record<string, string> = {}) {
	const commands: string[] = [];
	const ok = (stdout = "") => ({ stdout, stderr: "", exitCode: 0, timedOut: false, truncated: false });
	const sandbox: Sandbox = {
		id: "fake",
		workdir: "/w",
		async exec(command) {
			commands.push(command);
			if (command.startsWith("if [ -d")) return ok("file 10");
			if (command.startsWith("git diff")) return ok("+added line");
			const wanted = Object.keys(files).find((file) => command.includes(`'/w/${file}'`));
			return ok(wanted ? files[wanted] : "");
		},
		readFile: async () => new TextEncoder().encode("contents\n"),
		writeFile: async () => {},
		destroy: async () => {},
	};
	return { sandbox, commands };
}

const read = (path: string) => toolCalls({ name: "read", input: { path } });
const big = (result: ReturnType<typeof toolCalls>, input: number) => ({ ...result, usage: usage(input) });
const ask = [{ role: "user" as const, content: "Fix the date bug" }];
const sent = (model: MockLanguageModelV4, call: number) => JSON.stringify(model.doGenerateCalls[call]?.prompt);

describe("compaction", () => {
	it("starts below the window, and never later than the most we resend", () => {
		expect(compactionThreshold(100_000)).toBe(80_000);
		expect(compactionThreshold(1_000_000)).toBe(300_000);
		expect(compactionThreshold(undefined)).toBe(102_400);
	});

	it("replaces a history near the limit with a summary, and keeps the request", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [
				big(read("a.ts"), 9_000),
				answer("NOTES: read a.ts", usage(500, 50)),
				read("b.ts"),
				answer("Done."),
			],
		});
		const spent: AgentStep[] = [];
		const result = await runAgent({
			model, sandbox: fake().sandbox, messages: ask, contextTokens: 10_000,
			onSpend: (step) => void spent.push(step),
		});

		expect(result).toMatchObject({ text: "Done.", stoppedBy: "completed" });
		expect(sent(model, 1)).toContain("data to summarise");
		for (const call of [2, 3]) {
			expect(sent(model, call)).toContain("NOTES: read a.ts");
			expect(sent(model, call)).toContain("Fix the date bug");
		}
		// The last step is kept as it was, and the work after it builds up as usual.
		expect(sent(model, 2)).toContain(result.steps[0]?.toolCalls[0]?.toolCallId);
		expect(sent(model, 3)).toContain("b.ts");
		expect(spent).toHaveLength(1);
		expect(result.usage.inputTokens).toBe(9_000 + 500 + 100 + 100);
	});

	it("drops older steps from what is sent", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [read("old-file.ts"), big(read("recent.ts"), 9_000), answer("NOTES"), answer("Done.")],
		});
		await runAgent({ model, sandbox: fake().sandbox, messages: ask, contextTokens: 10_000 });
		expect(sent(model, 3)).toContain("recent.ts");
		expect(sent(model, 3)).not.toContain("old-file.ts");
	});

	it("stops compacting when it is needed again at once", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [
				big(read("a.ts"), 9_000),
				answer("NOTES"),
				big(read("b.ts"), 9_000),
				big(read("c.ts"), 9_000),
				answer("Done."),
			],
		});
		const result = await runAgent({ model, sandbox: fake().sandbox, messages: ask, contextTokens: 10_000 });
		expect(result.text).toBe("Done.");
		expect(model.doGenerateCalls.filter((call) => JSON.stringify(call.prompt).includes("data to summarise"))).toHaveLength(1);
	});

	it("leaves a short history alone", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [read("a.ts"), answer("Done.")] });
		await runAgent({ model, sandbox: fake().sandbox, messages: ask });
		expect(model.doGenerateCalls).toHaveLength(2);
	});

	it("carries on when summarising fails", async () => {
		let call = 0;
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				call++;
				if (call === 2) throw new Error("too busy");
				return call === 1 ? big(read("a.ts"), 9_000) : answer("Done.");
			},
		});
		const result = await runAgent({ model, sandbox: fake().sandbox, messages: ask, contextTokens: 10_000 });
		expect(result.text).toBe("Done.");
	});

	it("keeps a transcript within what one request can take", () => {
		const long = Array.from({ length: 500 }, () => ({ role: "user" as const, content: "x".repeat(5_000) }));
		expect(transcript(long, 1_000).length).toBeLessThan(2_200);
	});
});

describe("folder instructions", () => {
	it("lists the folders above a file, never outside the workspace", () => {
		expect(foldersAbove("/w", "apps/web/src/a.ts")).toEqual(["apps", "apps/web", "apps/web/src"]);
		expect(foldersAbove("/w", "/w/a.ts")).toEqual([]);
		expect(foldersAbove("/w", "../etc/passwd")).toEqual([]);
	});

	it("shows a folder's AGENTS.md once, when a file there is first read", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [read("web/a.ts"), read("web/b.ts"), answer("Done.")] });
		const result = await runAgent({
			model, sandbox: fake({ "web/AGENTS.md": "Use tabs in web." }).sandbox, messages: ask,
		});
		expect(String(result.steps[0]?.toolResults[0]?.output)).toContain("Use tabs in web.");
		expect(String(result.steps[1]?.toolResults[0]?.output)).not.toContain("Use tabs in web.");
	});
});

describe("skills", () => {
	it("reads the name and description, also over several lines", () => {
		expect(parseSkill("p", '---\nname: "deploy"\ndescription: >\n  Ship it\n  safely.\n---\nbody')).toEqual({
			name: "deploy", description: "Ship it safely.", path: "p",
		});
		expect(parseSkill("p", "no front matter")).toBeNull();
		expect(parseSkill("p", "---\nname: x\n---")).toBeNull();
	});

	it("lists a repository's skills, keeping the first of a name", async () => {
		const one = (path: string, text: string) => `\n__NF_SKILL__${path}\n---\nname: deploy\ndescription: ${text}\n---\n`;
		const sandbox = {
			...fake().sandbox,
			exec: async () => ({
				stdout: one(".agents/skills/deploy/SKILL.md", "first") + one(".claude/skills/deploy/SKILL.md", "second"),
				stderr: "", exitCode: 0, timedOut: false, truncated: false,
			}),
		};
		const skills = await readSkills(sandbox);
		expect(skills).toHaveLength(1);
		expect(skillInstructions(skills)).toContain("deploy (.agents/skills/deploy/SKILL.md): first");
		expect(skillInstructions([])).toBeNull();
	});
});

describe("task", () => {
	const review = toolCalls({ name: "task", input: { kind: "review", prompt: "Fix the date bug" } });

	it("reviews the diff in its own context and returns only the report", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [review, read("secret-reading.ts"), answer("REPORT: one problem"), answer("Done.")],
		});
		const spent: AgentStep[] = [];
		const result = await runAgent({
			model, sandbox: fake().sandbox, messages: ask, baseSha: "abc",
			onSpend: (step) => void spent.push(step),
		});

		expect(sent(model, 1)).toContain("+added line");
		expect(model.doGenerateCalls[1]?.tools?.map((tool) => tool.name).sort()).toEqual(["grep", "list", "read"]);
		expect(String(result.steps[0]?.toolResults[0]?.output)).toBe("REPORT: one problem");
		expect(sent(model, 3)).not.toContain("secret-reading.ts");
		expect(spent).toHaveLength(2);
		expect(result.usage.inputTokens).toBe(400);
	});

	it("counts the helper against the run's token limit", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [review, answer("REPORT", usage(5_000)), answer("never")] });
		const result = await runAgent({
			model, sandbox: fake().sandbox, messages: ask, baseSha: "abc", limits: { maxTokens: 4_000 },
		});
		expect(result.stoppedBy).toBe("token-budget");
		expect(model.doGenerateCalls).toHaveLength(2);
	});

	it("ends the run when the sandbox fails inside the helper", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [review, read("a.ts"), answer("x"), answer("y")] });
		const { sandbox } = fake();
		const broken = { ...sandbox, readFile: async () => Promise.reject(new Error("sandbox died")) };
		await expect(runAgent({ model, sandbox: broken, messages: ask, baseSha: "abc" })).rejects.toThrow("sandbox died");
	});

	it("is offered when planning too, where nothing can be changed", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [answer("Plan.")] });
		await runAgent({ model, sandbox: fake().sandbox, messages: ask, readOnly: true });
		expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name).sort()).toEqual(["grep", "list", "read", "task"]);
	});
});
