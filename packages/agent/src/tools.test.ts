import { DockerDriver, dockerAvailable, readText, type Sandbox } from "@nullfuse/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ToolError } from "./errors";
import { readProjectRules } from "./rules";
import { bashTool, createTools } from "./tools";

const IMAGE = process.env.SANDBOX_TEST_IMAGE ?? "alpine:3";

// Skipped locally without Docker; a failure in CI so they cannot silently stop.
const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the agent tool tests in CI");
}
if (!hasDocker) {
	console.warn("Docker is not running: skipping the agent tool tests");
}

describe.skipIf(!hasDocker)("tools", () => {
	let sandbox: Sandbox;
	let t: ReturnType<typeof createTools>;

	type Callable = { execute?: (input: never, options: never) => unknown };

	// Runs a tool's execute the way the agent loop does: a ToolError is what the
	// model would be shown, anything else propagates.
	const call = async (tool: Callable, input: unknown) => {
		const execute = tool.execute as (input: unknown, options: unknown) => Promise<string>;
		try {
			return { ok: true, output: await execute(input, { toolCallId: "test", messages: [] }) };
		} catch (error) {
			if (error instanceof ToolError) return { ok: false, output: error.message };
			throw error;
		}
	};

	const sh = (command: string) => sandbox.exec(command);

	beforeAll(async () => {
		sandbox = await new DockerDriver().create({ image: IMAGE, memoryMb: 512 });
		t = createTools({ sandbox });
	});

	afterAll(async () => {
		await sandbox?.destroy();
	});

	describe("list", () => {
		beforeAll(async () => {
			await sh(
				"mkdir -p proj/src/lib proj/node_modules/pkg proj/.git/objects proj/empty " +
					"&& touch proj/README.md proj/src/a.ts proj/src/lib/b.ts " +
					"proj/node_modules/pkg/x.js proj/.git/objects/y",
			);
		});

		it("lists entries sorted, with a slash after directories", async () => {
			const result = await call(t.list, { path: "proj" });
			expect(result).toEqual({ ok: true, output: "README.md\nempty/\nsrc/" });
		});

		it("hides .git and node_modules", async () => {
			const { output } = await call(t.list, { path: "proj", depth: 5 });
			expect(output).not.toContain("node_modules");
			expect(output).not.toContain(".git");
		});

		it("goes deeper with depth", async () => {
			const { output } = await call(t.list, { path: "proj", depth: 3 });
			expect(output.split("\n")).toEqual([
				"README.md",
				"empty/",
				"src/",
				"src/a.ts",
				"src/lib/",
				"src/lib/b.ts",
			]);
		});

		it("says when a directory is empty", async () => {
			expect((await call(t.list, { path: "proj/empty" })).output).toBe("(empty directory)");
		});

		it("lists the workspace by default", async () => {
			const { ok, output } = await call(t.list, {});
			expect(ok).toBe(true);
			expect(output).toContain("proj/");
		});

		it("refuses a missing path and a file", async () => {
			expect(await call(t.list, { path: "nope" })).toMatchObject({ ok: false });
			const file = await call(t.list, { path: "proj/README.md" });
			expect(file).toMatchObject({ ok: false });
			expect(file.output).toContain("read tool");
		});

		it("handles a directory name with spaces and quotes", async () => {
			await sh(`mkdir -p "we ird 'dir'" && touch "we ird 'dir'/f.txt"`);
			const result = await call(t.list, { path: "we ird 'dir'" });
			expect(result).toEqual({ ok: true, output: "f.txt" });
		});

		it("stops at 500 entries and says so", async () => {
			await sh("mkdir -p many && cd many && for i in $(seq 1 600); do touch f$i; done");
			const { output } = await call(t.list, { path: "many" });
			const lines = output.split("\n");
			expect(lines).toHaveLength(501);
			expect(lines.at(-1)).toContain("more than 500 entries");
		});
	});

	describe("read", () => {
		it("numbers the lines", async () => {
			await sandbox.writeFile("r/three.txt", "one\ntwo\nthree\n");
			const result = await call(t.read, { path: "r/three.txt" });
			expect(result).toEqual({
				ok: true,
				output: "     1\tone\n     2\ttwo\n     3\tthree",
			});
		});

		it("reads a window with offset and limit and tells how to continue", async () => {
			await sandbox.writeFile("r/ten.txt", `${Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")}\n`);
			const { output } = await call(t.read, { path: "r/ten.txt", offset: 3, limit: 2 });
			expect(output).toBe(
				"     3\tline 3\n     4\tline 4\n[showing lines 3-4 of 10; call read again with offset 5 to continue]",
			);
		});

		it("returns 2000 lines by default", async () => {
			await sh("seq 1 3000 > r/long.txt");
			const { output } = await call(t.read, { path: "r/long.txt" });
			const lines = output.split("\n");
			expect(lines).toHaveLength(2001);
			expect(lines.at(-1)).toContain("offset 2001");
		});

		it("handles a file with no trailing newline and an empty file", async () => {
			await sandbox.writeFile("r/nonl.txt", "a\nb");
			expect((await call(t.read, { path: "r/nonl.txt" })).output).toBe("     1\ta\n     2\tb");
			await sandbox.writeFile("r/empty.txt", "");
			expect((await call(t.read, { path: "r/empty.txt" })).output).toBe("(empty file)");
		});

		it("cuts a very long line", async () => {
			await sandbox.writeFile("r/wide.txt", `${"x".repeat(5000)}\n`);
			const { output } = await call(t.read, { path: "r/wide.txt" });
			expect(output).toContain("[line cut at 2000 characters]");
			expect(output.length).toBeLessThan(2100);
		});

		it("refuses a missing file, a directory and an offset past the end", async () => {
			expect(await call(t.read, { path: "r/missing.txt" })).toMatchObject({ ok: false });
			const dir = await call(t.read, { path: "r" });
			expect(dir.ok).toBe(false);
			expect(dir.output).toContain("list tool");
			const past = await call(t.read, { path: "r/three.txt", offset: 99 });
			expect(past.ok).toBe(false);
			expect(past.output).toContain("3 lines");
		});

		it("refuses binary and oversized files with advice", async () => {
			await sandbox.writeFile("r/bin.dat", Uint8Array.from([65, 0, 66]));
			const binary = await call(t.read, { path: "r/bin.dat" });
			expect(binary.ok).toBe(false);
			expect(binary.output).toContain("binary");

			await sh("head -c 1500000 /dev/zero | tr '\\0' a > r/huge.txt");
			const huge = await call(t.read, { path: "r/huge.txt" });
			expect(huge.ok).toBe(false);
			expect(huge.output).toContain("too large");
			expect(huge.output).toContain("grep");
		});
	});

	describe("write", () => {
		it("creates a file and its parent directories", async () => {
			const result = await call(t.write, { path: "w/a/b/new.txt", content: "hello\nworld\n" });
			expect(result).toEqual({ ok: true, output: "Created w/a/b/new.txt (2 lines, 12 bytes)." });
			expect(await readText(sandbox, "w/a/b/new.txt")).toBe("hello\nworld\n");
		});

		it("says when it overwrites", async () => {
			await call(t.write, { path: "w/over.txt", content: "first" });
			const result = await call(t.write, { path: "w/over.txt", content: "second" });
			expect(result.output).toMatch(/^Overwrote w\/over.txt/);
			expect(await readText(sandbox, "w/over.txt")).toBe("second");
		});

		it("keeps unicode intact and counts bytes", async () => {
			const result = await call(t.write, { path: "w/u.txt", content: "héllo ✓" });
			expect(result.output).toContain("10 bytes");
			expect(await readText(sandbox, "w/u.txt")).toBe("héllo ✓");
		});

		it("refuses a directory", async () => {
			expect(await call(t.write, { path: "w", content: "x" })).toMatchObject({ ok: false });
		});
	});

	describe("edit", () => {
		const file = "e/code.ts";
		const original = "const a = 1;\nconst b = 2;\nfunction f() {\n  return a + b;\n}\n";

		const reset = () => sandbox.writeFile(file, original);

		it("replaces one occurrence and shows the changed lines", async () => {
			await reset();
			const result = await call(t.edit, {
				path: file,
				oldString: "return a + b;",
				newString: "return a * b;",
			});
			expect(result.ok).toBe(true);
			expect(result.output).toContain("replaced 1 occurrence");
			expect(result.output).toContain("     4\t  return a * b;");
			expect(await readText(sandbox, file)).toBe(original.replace("a + b", "a * b"));
		});

		it("explains a text that is not found", async () => {
			await reset();
			const result = await call(t.edit, { path: file, oldString: "nope", newString: "x" });
			expect(result.ok).toBe(false);
			expect(result.output).toContain("not found");
			expect(await readText(sandbox, file)).toBe(original);
		});

		it("refuses an ambiguous match and says how many", async () => {
			await reset();
			const result = await call(t.edit, { path: file, oldString: "const", newString: "let" });
			expect(result.ok).toBe(false);
			expect(result.output).toContain("2 times");
			expect(await readText(sandbox, file)).toBe(original);
		});

		it("replaces every occurrence with replaceAll", async () => {
			await reset();
			const result = await call(t.edit, {
				path: file,
				oldString: "const",
				newString: "let",
				replaceAll: true,
			});
			expect(result.output).toContain("replaced 2 occurrences");
			expect(await readText(sandbox, file)).toBe(original.replaceAll("const", "let"));
		});

		it("treats $ patterns in the new text literally", async () => {
			await reset();
			await call(t.edit, { path: file, oldString: "a = 1", newString: "a = '$& $1 $$'" });
			expect(await readText(sandbox, file)).toContain("const a = '$& $1 $$';");
		});

		it("deletes with an empty newString and handles multi-line text", async () => {
			await reset();
			await call(t.edit, { path: file, oldString: "function f() {\n  return a + b;\n}\n", newString: "" });
			expect(await readText(sandbox, file)).toBe("const a = 1;\nconst b = 2;\n");
		});

		it("keeps CRLF line endings", async () => {
			await sandbox.writeFile("e/crlf.txt", "one\r\ntwo\r\n");
			await call(t.edit, { path: "e/crlf.txt", oldString: "two", newString: "2" });
			expect(await readText(sandbox, "e/crlf.txt")).toBe("one\r\n2\r\n");
		});

		it("refuses identical strings and a missing file", async () => {
			await reset();
			expect((await call(t.edit, { path: file, oldString: "a", newString: "a" })).ok).toBe(false);
			const missing = await call(t.edit, { path: "e/none.ts", oldString: "a", newString: "b" });
			expect(missing.output).toContain("write tool");
		});
	});

	describe("grep", () => {
		beforeAll(async () => {
			await sh(
				"mkdir -p g/src g/node_modules/p g/.git && " +
					"printf 'const needle = 1;\\nconst other = 2;\\n' > g/src/a.ts && " +
					"printf 'NEEDLE here\\n' > g/src/b.md && " +
					"printf 'needle in a dependency\\n' > g/node_modules/p/x.js && " +
					"printf 'needle in git\\n' > g/.git/config",
			);
		});

		it("returns path:line:text", async () => {
			const result = await call(t.grep, { pattern: "needle", path: "g/src" });
			expect(result).toEqual({ ok: true, output: "g/src/a.ts:1:const needle = 1;" });
		});

		it("skips node_modules and .git", async () => {
			const { output } = await call(t.grep, { pattern: "needle", path: "g", ignoreCase: true });
			expect(output).not.toContain("node_modules");
			expect(output).not.toContain(".git");
			expect(output.split("\n")).toHaveLength(2);
		});

		it("filters by file name with include", async () => {
			const { output } = await call(t.grep, {
				pattern: "needle",
				path: "g",
				include: "*.md",
				ignoreCase: true,
			});
			expect(output).toBe("g/src/b.md:1:NEEDLE here");
		});

		it("says when nothing matches", async () => {
			expect(await call(t.grep, { pattern: "zzz", path: "g" })).toEqual({
				ok: true,
				output: "No matches.",
			});
		});

		it("reports an invalid regular expression", async () => {
			const result = await call(t.grep, { pattern: "(", path: "g" });
			expect(result.ok).toBe(false);
			expect(result.output).toContain("grep failed");
		});

		it("accepts patterns that look like options or shell", async () => {
			await sandbox.writeFile("g/odd.txt", "-e and 'quote' and $(x)\n");
			for (const pattern of ["-e", "'quote'", "\\$\\(x\\)"]) {
				const { ok, output } = await call(t.grep, { pattern, path: "g/odd.txt" });
				expect(ok).toBe(true);
				expect(output).toContain("g/odd.txt:1:");
			}
		});

		it("caps the number of matches", async () => {
			await sh("mkdir -p g/many && seq 1 500 | sed 's/^/match /' > g/many/m.txt");
			const { output } = await call(t.grep, { pattern: "match", path: "g/many" });
			const lines = output.split("\n");
			expect(lines).toHaveLength(201);
			expect(lines.at(-1)).toContain("there are more");
		});
	});

	describe("bash", () => {
		it("returns output with no extra notes on success", async () => {
			expect(await call(t.bash, { command: "echo hi" })).toEqual({ ok: true, output: "hi\n" });
		});

		it("reports a non-zero exit code without treating it as a tool error", async () => {
			const result = await call(t.bash, { command: "echo out; exit 4" });
			expect(result).toEqual({ ok: true, output: "out\n\n[exit code: 4]" });
		});

		it("labels stderr", async () => {
			const result = await call(t.bash, { command: "echo out; echo oops >&2" });
			expect(result.output).toBe("out\n[stderr]\noops\n");
		});

		it("says so when there is no output", async () => {
			expect((await call(t.bash, { command: "true" })).output).toBe("(no output)");
		});

		it("runs in the given directory", async () => {
			await sh("mkdir -p b/here");
			const result = await call(t.bash, { command: "pwd", cwd: "/workspace/b/here" });
			expect(result.output).toBe("/workspace/b/here\n");
		});

		it("passes the project environment to the command", async () => {
			const result = await call(bashTool(sandbox, { API_KEY: "abc" }), { command: 'printf %s "$API_KEY"' });
			expect(result.output).toBe("abc");
		});

		it("does not keep shell state between calls", async () => {
			await call(t.bash, { command: "export KEEP=1" });
			expect((await call(t.bash, { command: 'echo "[$KEEP]"' })).output).toBe("[]\n");
		});

		it("stops a command at the timeout and says what that did", async () => {
			const result = await call(t.bash, { command: "sleep 30", timeoutSeconds: 1 });
			expect(result.ok).toBe(true);
			expect(result.output).toContain("timed out after 1s");
		});

		it("keeps the start and the end of long output", async () => {
			const result = await call(t.bash, {
				command: "echo START; seq 1 20000; echo THE-END",
			});
			expect(result.output.startsWith("START")).toBe(true);
			expect(result.output).toContain("characters omitted");
			expect(result.output.trimEnd().endsWith("THE-END")).toBe(true);
			expect(result.output.length).toBeLessThan(31_000);
		});
	});

	describe("parallel changes", () => {
		it("keeps every edit when the model changes one file several times at once", async () => {
			await sh("printf 'one\\ntwo\\nthree\\n' > shared.txt");
			const results = await Promise.all([
				call(t.edit, { path: "shared.txt", oldString: "one", newString: "1" }),
				call(t.edit, { path: "./shared.txt", oldString: "two", newString: "2" }),
				call(t.edit, { path: `${sandbox.workdir}/shared.txt`, oldString: "three", newString: "3" }),
			]);
			expect(results.every((result) => result.ok)).toBe(true);
			expect((await sh("cat shared.txt")).stdout).toBe("1\n2\n3\n");
		});

		it("goes on after a change that fails", async () => {
			await sh("printf 'a' > queue.txt");
			const [bad, good] = await Promise.all([
				call(t.edit, { path: "queue.txt", oldString: "missing", newString: "x" }),
				call(t.edit, { path: "queue.txt", oldString: "a", newString: "b" }),
			]);
			expect([bad.ok, good.ok]).toEqual([false, true]);
		});
	});

	describe("project rules", () => {
		it("reads the root instruction files once each, and cuts huge ones", async () => {
			expect(await readProjectRules(sandbox)).toEqual([]);
			await sh("printf 'Use tabs.' > AGENTS.md && ln -s AGENTS.md CLAUDE.md");
			expect(await readProjectRules(sandbox)).toEqual([{ file: "AGENTS.md", text: "Use tabs." }]);
			await sh("rm CLAUDE.md && head -c 30000 /dev/zero | tr '\\0' x > CLAUDE.md");
			const [, large] = await readProjectRules(sandbox);
			expect(large?.text.length).toBeLessThan(20_100);
			expect(large?.text).toContain("[cut: read CLAUDE.md");
			await sh("rm AGENTS.md CLAUDE.md");
		});
	});

	describe("createTools", () => {
		it("offers the six tools, each with a description", () => {
			expect(Object.keys(t)).toEqual(["list", "read", "grep", "edit", "write", "bash"]);
			for (const tool of Object.values(t)) {
				expect(tool.description?.length).toBeGreaterThan(40);
			}
		});
	});
});
