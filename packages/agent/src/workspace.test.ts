import { randomUUID } from "node:crypto";
import {
	DockerDriver,
	dockerAvailable,
	ensureSandboxImage,
	type ExecOptions,
	type ExecResult,
	readText,
	type Sandbox,
} from "@nullfuse/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	changedFiles,
	changedSince,
	MAX_COMMIT_FILES,
	mergeProblem,
	startBaseMerge,
	parseStatus,
	prepareWorkspace,
	saveProgress,
	WorkspaceError,
	type WorkspaceSpec,
	workingBranchFor,
} from "./workspace";
import { type GitRemote, startGitRemote } from "./testing";

const author = { name: "Prefill Code", email: "code@example.test" };

// Skipped locally without Docker; a failure in CI so they cannot silently stop.
const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the workspace tests in CI");
}
if (!hasDocker) {
	console.warn("Docker is not running: skipping the workspace tests");
}

function fakeSandbox() {
	const calls: { command: string; env: Record<string, string> }[] = [];
	const base = { stderr: "", timedOut: false, truncated: false };
	const sandbox: Sandbox = {
		id: "fake",
		workdir: "/workspace",
		async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
			calls.push({ command, env: options?.env ?? {} });
			if (command.includes("ls-remote")) return { ...base, exitCode: 0, stdout: "" };
			if (command.includes("diff --cached --quiet")) return { ...base, exitCode: 1, stdout: "" };
			if (command.includes("wc -l") || command.includes("awk")) {
				return { ...base, exitCode: 0, stdout: "1\n" };
			}
			return { ...base, exitCode: 0, stdout: "abc123\n" };
		},
		async readFile() {
			return new Uint8Array();
		},
		async writeFile() {},
		async destroy() {},
	};
	return { sandbox, calls };
}

describe("how git is called", () => {
	const token = "ghs_secretInstallationToken";
	const spec: WorkspaceSpec = {
		repoUrl: "https://github.com/acme/app.git",
		baseBranch: "main",
		workingBranch: "nullfuse/chat-12345678",
		author,
		token,
	};
	const basic = Buffer.from(`x-access-token:${token}`).toString("base64");

	it("sends the token only in the environment of commands that use the network", async () => {
		const { sandbox, calls } = fakeSandbox();
		await prepareWorkspace(sandbox, spec);
		await saveProgress(sandbox, spec);

		const network = calls.filter((call) => /\b(ls-remote|clone|push)\b/.test(call.command));
		expect(network.map((call) => call.command.match(/\b(ls-remote|clone|push)\b/)?.[0])).toEqual([
			"ls-remote",
			"clone",
			"push",
		]);
		for (const call of network) {
			expect(call.env.GIT_CONFIG_KEY_0).toBe("http.https://github.com/.extraheader");
			expect(call.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${basic}`);
		}

		const local = calls.filter((call) => !network.includes(call));
		expect(local.length).toBeGreaterThan(0);
		for (const call of local) expect(Object.keys(call.env).some((key) => key.startsWith("GIT_CONFIG_"))).toBe(false);
	});

	it("never puts the token on a command line", async () => {
		const { sandbox, calls } = fakeSandbox();
		await prepareWorkspace(sandbox, spec);
		await saveProgress(sandbox, spec);

		for (const call of calls) {
			expect(call.command).not.toContain(token);
			expect(call.command).not.toContain(basic);
		}
	});

	it("overrides the repository's own git settings on every command", async () => {
		const { sandbox, calls } = fakeSandbox();
		await prepareWorkspace(sandbox, spec);
		await saveProgress(sandbox, spec);

		const gitCalls = calls.filter((call) => call.command.startsWith("git "));
		expect(gitCalls.length).toBeGreaterThan(5);
		for (const call of gitCalls) {
			expect(call.command).toContain("'core.hooksPath=/dev/null'");
			expect(call.command).toContain("'credential.helper='");
			expect(call.command).toContain("'http.proxy='");
		}
	});

	it("refuses to send a token over anything but https, before running anything", async () => {
		const { sandbox, calls } = fakeSandbox();
		await expect(
			prepareWorkspace(sandbox, { ...spec, repoUrl: "git://example.test/app.git" }),
		).rejects.toThrow(WorkspaceError);
		expect(calls).toHaveLength(0);
	});

	it("works without a token for a public or local repository", async () => {
		const { sandbox, calls } = fakeSandbox();
		await prepareWorkspace(sandbox, { ...spec, token: undefined, repoUrl: "git://example.test/app.git" });
		for (const call of calls) expect(call.env.GIT_CONFIG_COUNT).toBeUndefined();
	});

	it("names a chat's branch from its id", () => {
		expect(workingBranchFor("0e1d2c3b-aaaa-bbbb-cccc-ddddeeeeffff")).toBe("nullfuse/chat-0e1d2c3b");
	});
});


describe("parseStatus", () => {
	const nul = (...entries: string[]) => `${entries.join("\0")}\0`;

	it("reads modified, added, deleted, untracked and renamed files", () => {
		const output = nul(
			" M src/a.ts",
			"A  added.ts",
			" D gone.ts",
			"?? notes/new.txt",
			"R  new-name.ts",
			"old-name.ts",
			"MM both.ts",
		);
		expect(parseStatus(output)).toEqual([
			{ path: "added.ts", status: "added" },
			{ path: "both.ts", status: "modified" },
			{ path: "gone.ts", status: "deleted" },
			{ path: "new-name.ts", status: "renamed" },
			{ path: "notes/new.txt", status: "added" },
			{ path: "src/a.ts", status: "modified" },
		]);
	});

	it("keeps names with spaces and unicode, and returns nothing for a clean tree", () => {
		expect(parseStatus(nul("?? my file ✓.txt"))).toEqual([{ path: "my file ✓.txt", status: "added" }]);
		expect(parseStatus("")).toEqual([]);
	});

	it("stops at 200 files", () => {
		const output = nul(...Array.from({ length: 250 }, (_, i) => `?? f${String(i).padStart(3, "0")}`));
		expect(parseStatus(output)).toHaveLength(200);
	});
});

describe.skipIf(!hasDocker)("workspace in a real sandbox", () => {
	const driver = new DockerDriver();
	const boxes: Sandbox[] = [];
	let image: string;
	let remote: GitRemote;

	const newBox = async () => {
		const box = await driver.create({ image, memoryMb: 512 });
		boxes.push(box);
		return box;
	};

	const specFor = (): WorkspaceSpec => ({
		repoUrl: remote.url,
		baseBranch: "main",
		workingBranch: `nullfuse/test-${randomUUID().slice(0, 8)}`,
		author,
	});

	const onRemote = (command: string) => remote.git(command);

	beforeAll(async () => {
		image = await ensureSandboxImage();
		remote = await startGitRemote(driver, image);
		boxes.push(remote.sandbox);
	}, 600_000);

	afterAll(async () => {
		await Promise.all(boxes.map((box) => box.destroy()));
	});

	it("clones the base branch and starts the working branch", async () => {
		const box = await newBox();
		const spec = specFor();

		const result = await prepareWorkspace(box, spec);
		expect(result.resumed).toBe(false);
		expect(result.headSha).toMatch(/^[0-9a-f]{40}$/);

		expect((await box.exec("git branch --show-current")).stdout.trim()).toBe(spec.workingBranch);
		expect(await readText(box, "src/a.ts")).toBe("export const a = 1;\n");
		expect((await box.exec("git config user.name && git config user.email")).stdout).toBe(
			"Prefill Code\ncode@example.test\n",
		);
	});

	it("saves work as commits on the remote working branch and leaves the base alone", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);

		await box.writeFile("src/a.ts", "export const a = 2;\n");
		await box.writeFile("new/b.ts", "export const b = 1;\n");
		await box.exec("rm README.md");
		const saved = await saveProgress(box, spec, "WIP: first pass");

		expect(saved).toMatchObject({ saved: true, committed: true });
		expect((await onRemote(`log --format=%s ${spec.workingBranch}`)).stdout).toBe("WIP: first pass\ninitial\n");
		expect((await onRemote(`show ${spec.workingBranch}:src/a.ts`)).stdout).toBe("export const a = 2;\n");
		expect((await onRemote(`show ${spec.workingBranch}:new/b.ts`)).stdout).toBe("export const b = 1;\n");
		expect((await onRemote(`ls-tree --name-only ${spec.workingBranch}`)).stdout).not.toContain("README.md");
		expect((await onRemote("log --format=%s main")).stdout).toBe("initial\n");
		expect((await onRemote(`log -1 --format=%an,%ae ${spec.workingBranch}`)).stdout.trim()).toBe(
			"Prefill Code,code@example.test",
		);
	});

	it("commits nothing when nothing changed, and again after more work", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);

		await box.writeFile("one.txt", "1");
		const first = await saveProgress(box, spec, "WIP: one");
		const second = await saveProgress(box, spec, "WIP: unchanged");
		expect(second).toMatchObject({ saved: true, committed: false });
		expect(second.saved && second.sha).toBe(first.saved && first.sha);

		await box.writeFile("two.txt", "2");
		const third = await saveProgress(box, spec, "WIP: two");
		expect(third).toMatchObject({ saved: true, committed: true });
		expect((await onRemote(`log --format=%s ${spec.workingBranch}`)).stdout).toBe(
			"WIP: two\nWIP: one\ninitial\n",
		);
	});

	it("continues from the saved work in a brand new sandbox", async () => {
		const spec = specFor();

		const first = await newBox();
		await prepareWorkspace(first, spec);
		await first.writeFile("notes.txt", "from the first run\n");
		await saveProgress(first, spec, "WIP: first run");
		await first.destroy();

		const second = await newBox();
		const resumed = await prepareWorkspace(second, spec);
		expect(resumed.resumed).toBe(true);
		expect(await readText(second, "notes.txt")).toBe("from the first run\n");
		expect((await second.exec("git branch --show-current")).stdout.trim()).toBe(spec.workingBranch);

		await second.writeFile("notes.txt", "from the first run\nand the second\n");
		await saveProgress(second, spec, "WIP: second run");
		expect((await onRemote(`log --format=%s ${spec.workingBranch}`)).stdout).toBe(
			"WIP: second run\nWIP: first run\ninitial\n",
		);
		expect((await onRemote("log --format=%s main")).stdout).toBe("initial\n");
	});

	it("does not run the repository's hooks or obey its git settings", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);

		await box.exec(
			[
				"mkdir -p .git/hooks /tmp/evil",
				"for hook in pre-commit pre-push; do printf '#!/bin/sh\\ntouch /tmp/hook-ran\\n' > .git/hooks/$hook; chmod +x .git/hooks/$hook; cp .git/hooks/$hook /tmp/evil/$hook; done",
				"git config core.hooksPath /tmp/evil",
				"git config commit.gpgsign true",
				"git config gpg.program false",
				"git config credential.helper 'touch /tmp/helper-ran #'",
			].join(" && "),
		);
		await box.writeFile("work.txt", "x");

		expect(await saveProgress(box, spec)).toMatchObject({ saved: true, committed: true });
		expect((await box.exec("ls /tmp/hook-ran /tmp/helper-ran 2>&1")).stdout).not.toContain("/tmp/hook-ran\n");
		expect((await box.exec("test -e /tmp/hook-ran")).exitCode).not.toBe(0);
		expect((await box.exec("test -e /tmp/helper-ran")).exitCode).not.toBe(0);
	});

	it("refuses to commit a huge change, and leaves nothing staged or pushed", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);

		await box.exec("head -c 60000000 /dev/zero > huge.bin");
		const result = await saveProgress(box, spec);

		expect(result).toMatchObject({ saved: false, reason: "too_large", files: 1 });
		expect((await box.exec("git diff --cached --quiet")).exitCode).toBe(0);
		expect((await onRemote(`rev-parse --verify --quiet ${spec.workingBranch}`)).exitCode).not.toBe(0);
	}, 120_000);

	it("refuses to commit too many files", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);

		await box.exec(
			`mkdir many && cd many && i=0 && while [ $i -le ${MAX_COMMIT_FILES} ]; do : > f$i; i=$((i+1)); done`,
		);
		const result = await saveProgress(box, spec);

		expect(result).toMatchObject({ saved: false, reason: "too_large" });
		expect((await box.exec("git diff --cached --quiet")).exitCode).toBe(0);
	}, 120_000);

	it("reports a repository it cannot reach", async () => {
		const box = await newBox();
		const spec = { ...specFor(), repoUrl: "git://127.0.0.1:1/nope.git" };
		await expect(prepareWorkspace(box, spec)).rejects.toThrow(/git ls-remote failed/);
	});

	it("refuses to clone into a workspace that already has files", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);
		await expect(prepareWorkspace(box, spec)).rejects.toThrow(/git clone failed/);
	});

	it("lists what the run has changed so far, and nothing once it is committed", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);
		expect(await changedFiles(box)).toEqual([]);

		await box.exec("rm README.md && git mv src/a.ts src/b.ts");
		await box.writeFile("deep/er/new file.txt", "x");
		expect(await changedFiles(box)).toEqual([
			{ path: "deep/er/new file.txt", status: "added" },
			{ path: "README.md", status: "deleted" },
			{ path: "src/b.ts", status: "renamed" },
		]);

		await saveProgress(box, spec, "WIP: save");
		expect(await changedFiles(box)).toEqual([]);
	});

	it("lists files changed since the start, committed or not", async () => {
		const box = await newBox();
		const spec = specFor();
		const { headSha } = await prepareWorkspace(box, spec);
		await box.writeFile("saved.txt", "one\n");
		await saveProgress(box, spec);
		await box.writeFile("fresh.txt", "two\n");
		await box.exec("rm README.md");

		expect(await changedSince(box, headSha)).toEqual([
			{ path: "fresh.txt", status: "added" },
			{ path: "README.md", status: "deleted" },
			{ path: "saved.txt", status: "added" },
		]);
	});

	// A chat branch with one saved change, then another change that reaches main.
	async function diverged(chatLine: string, mainLine: string, mainFile = "README.md") {
		const spec = specFor();
		const base = { ...spec, baseBranch: `base-${randomUUID().slice(0, 8)}` };
		await remote.git(`branch ${base.baseBranch} main`);
		const first = await newBox();
		await prepareWorkspace(first, base);
		await first.writeFile("README.md", chatLine);
		await saveProgress(first, base);
		const other = await newBox();
		const toBase = { ...base, workingBranch: base.baseBranch };
		await prepareWorkspace(other, toBase);
		await other.writeFile(mainFile, mainLine);
		await saveProgress(other, toBase);
		const box = await newBox();
		await prepareWorkspace(box, base);
		return { box, spec: base };
	}
	const onBranch = async (branch: string, file: string) => (await remote.git(`show ${branch}:${file}`)).stdout;

	it("merges a base that moved on, and saves it as a merge", async () => {
		const { box, spec } = await diverged("from the chat\n", "from main\n", "other.txt");

		const merge = await startBaseMerge(box, spec);
		expect(merge).toMatchObject({ state: "merged", conflicts: [] });
		expect(await mergeProblem(box, merge)).toBeNull();
		await saveProgress(box, spec, "Merge");

		expect(await onBranch(spec.workingBranch, "other.txt")).toBe("from main\n");
		expect(await onBranch(spec.workingBranch, "README.md")).toBe("from the chat\n");
		expect((await remote.git(`log -1 --format=%P ${spec.workingBranch}`)).stdout.trim().split(" ")).toHaveLength(2);
	});

	it("reports conflicts until they are resolved", async () => {
		const { box, spec } = await diverged("from the chat\n", "from main\n");

		const merge = await startBaseMerge(box, spec);
		expect(merge).toMatchObject({ state: "conflicts", conflicts: ["README.md"] });
		expect(await mergeProblem(box, merge)).toContain("README.md");

		await box.writeFile("README.md", "from the chat\n");
		expect(await mergeProblem(box, merge)).toBeNull();
		await saveProgress(box, spec, "Merge");
		// Kept the chat's own text, and the merge is still recorded.
		expect((await startBaseMerge(box, spec)).state).toBe("current");
	});

	it("refuses to save a merge that was abandoned", async () => {
		const { box, spec } = await diverged("from the chat\n", "from main\n");
		const merge = await startBaseMerge(box, spec);
		await box.exec("git merge --abort");

		expect(await mergeProblem(box, merge)).toContain("abandoned");
	});

	it("does nothing when the branch already has the base", async () => {
		const box = await newBox();
		const spec = specFor();
		await prepareWorkspace(box, spec);
		await saveProgress(box, spec);

		expect(await startBaseMerge(box, spec)).toEqual({ state: "current" });
	});
});
