import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { workingBranchFor } from "@nullfuse/agent";
import { answer, asStream, type GitRemote, startGitRemote, toolCalls } from "@nullfuse/agent/testing";
import {
	addMessage,
	chat,
	claimRun,
	getRunLive,
	createChat,
	getChatForUser,
	installation,
	listMessages,
	listRuns,
	listRunSteps,
	project,
	projectEnvVar,
	requestStop,
	run as runTable,
	sweepStaleRuns,
} from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import {
	type CreateSandboxOptions,
	DockerDriver,
	dockerAvailable,
	ensureSandboxImage,
	type ExecOptions,
	type ExecResult,
	type Sandbox,
	SandboxCapacityError,
	type SandboxDriver,
} from "@nullfuse/sandbox";
import { decryptEnvValue, encryptEnvValue } from "@nullfuse/secrets";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRun, type PullRequestInput, type RunnerDeps } from "./execute";

const run = promisify(execFile);
const author = { name: "Prefill Code", email: "code@example.test" };
const key = randomBytes(32);

const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the runner tests in CI");
}
if (!hasDocker) {
	console.warn("Docker is not running: skipping the runner tests");
}

const db = connect();
const fixtures = new Fixtures(db);

class SpyDriver implements SandboxDriver {
	readonly name = "spy";
	created = 0;
	destroyed = 0;
	ids: string[] = [];

	constructor(private inner: DockerDriver) {}

	async create(options?: CreateSandboxOptions): Promise<Sandbox> {
		const box = await this.inner.create(options);
		this.created++;
		this.ids.push(box.id);
		return Object.create(box, {
			destroy: {
				value: async () => {
					this.destroyed++;
					await box.destroy();
				},
			},
		}) as Sandbox;
	}
}

async function waitFor(check: () => Promise<boolean>, ms = 20_000) {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("timed out waiting for a condition");
}

const slow = <T>(ms: number, result: T) => (options: { abortSignal?: AbortSignal }) =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => resolve(result), ms);
		options.abortSignal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(options.abortSignal?.reason);
		});
	});

describe.skipIf(!hasDocker)("executeRun", () => {
	const docker = new DockerDriver();
	let spy: SpyDriver;
	let image: string;
	let remote: GitRemote;

	beforeAll(async () => {
		image = await ensureSandboxImage();
		remote = await startGitRemote(docker, image);
	});

	afterAll(async () => {
		await remote?.sandbox.destroy();
		await fixtures.cleanup();
		await db.$client.end();
	});

	const deps = (model: LanguageModel, overrides: Partial<RunnerDeps> = {}): RunnerDeps => {
		spy = new SpyDriver(docker);
		return {
			db,
			driver: spy,
			image,
			createModel: () => model,
			githubToken: async () => "unused-token",
			decryptEnvValue: (projectId, name, stored) => decryptEnvValue(key, projectId, name, stored),
			author,
			repoUrl: () => remote.url,
			...overrides,
		};
	};

	async function setup(
		options: {
			installCommand?: string;
			testCommand?: string;
			verify?: boolean;
			env?: Record<string, string>;
			message?: string;
		} = {},
	) {
		const userId = await fixtures.user();
		const projectId = await fixtures.project(userId);
		if (options.installCommand) {
			await db.update(project).set({ installCommand: options.installCommand }).where(eq(project.id, projectId));
		}
		if (options.testCommand) {
			await db.update(project).set({ testCommand: options.testCommand }).where(eq(project.id, projectId));
		}
		for (const [name, value] of Object.entries(options.env ?? {})) {
			await db
				.insert(projectEnvVar)
				.values({ projectId, name, valueEncrypted: encryptEnvValue(key, projectId, name, value) });
		}
		const created = await createChat(db, {
			userId,
			projectId,
			baseBranch: "main",
			model: "deepseek-v4-pro",
			content: options.message ?? "Add a notes file",
			verify: options.verify,
		});
		if (!created.ok) throw new Error(`createChat failed: ${created.reason}`);
		return { userId, projectId, ...created, branch: workingBranchFor(created.chatId) };
	}

	async function followUp(userId: string, chatId: string, content: string) {
		const result = await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content });
		if (!result.ok) throw new Error(`addMessage failed: ${result.reason}`);
		return result;
	}

	const systemPrompt = (model: MockLanguageModelV4, call = 0) => {
		const first = model.doGenerateCalls[call]?.prompt[0];
		return first?.role === "system" ? first.content : "";
	};

	const containerGone = (id: string) => run("docker", ["inspect", id]).then(
		() => false,
		() => true,
	);

	it("takes a queued message to a finished run: setup, agent, saved steps, committed work, answer", async () => {
		const { userId, chatId, runId, branch } = await setup({
			installCommand: "echo set-up > setup.txt",
			env: { API_KEY: "s3cr3t-key-value" },
		});
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "notes.txt", content: "hello\n" } }),
				toolCalls({ name: "bash", input: { command: 'cat setup.txt; printf "key=%s" "$API_KEY"' } }),
				answer("Wrote notes.txt. The key is s3cr3t-key-value."),
			],
		});

		const result = await executeRun(deps(model), runId);
		expect(result).toEqual({ claimed: true, status: "succeeded", stopReason: "completed" });

		const [row] = await listRuns(db, userId, chatId);
		expect(row).toMatchObject({ status: "succeeded", stopReason: "completed", inputTokens: 300, outputTokens: 60 });

		const steps = await listRunSteps(db, userId, runId);
		expect(steps.map((step) => step.stepIndex)).toEqual([0, 1, 2]);
		const printed = steps[1]?.toolResults[0]?.output ?? "";
		expect(printed).toContain("set-up");
		expect(printed).toContain("key=[hidden]");
		expect(JSON.stringify(steps)).not.toContain("s3cr3t-key-value");

		const messages = await listMessages(db, userId, chatId);
		expect(messages.at(-1)).toMatchObject({
			role: "assistant",
			content: "Wrote notes.txt. The key is [hidden].",
		});

		const [chatRow] = await db.select().from(chat).where(eq(chat.id, chatId));
		expect(chatRow?.workingBranch).toBe(branch);
		expect((await remote.git(`log --format=%s ${branch}`)).stdout).toBe("WIP: Add a notes file\ninitial\n");
		expect((await remote.git(`show ${branch}:notes.txt`)).stdout).toBe("hello\n");

		const prompt = systemPrompt(model);
		expect(prompt).toContain("Dependencies were set up with `echo set-up > setup.txt`");
		expect(prompt).toContain(`You are on the branch ${branch}`);

		expect(spy.created).toBe(1);
		expect(spy.destroyed).toBe(1);
		expect(await containerGone(spy.ids[0] ?? "")).toBe(true);
	});

	describe("a user's own model", () => {
		const apiKey = "sk-user-own-key-987654";
		const ownKey = `own:${crypto.randomUUID()}`;
		// The name is set directly: choosing a model is the database's own test.
		async function ownRun() {
			const created = await setup();
			await db.update(runTable).set({ model: ownKey }).where(eq(runTable.id, created.runId));
			return created;
		}
		const neverOurs = () => {
			throw new Error("our model must not be used");
		};
		const own = (model: LanguageModel) => async () => ({
			model,
			settings: {},
			apiKey,
			cost: () => 7,
			explain: () => "Your provider rejected the API key.",
		});

		it("uses it, prices it, and keeps the key out of the sandbox and what is saved", async () => {
			const { userId, chatId, runId } = await ownRun();
			const model = new MockLanguageModelV4({
				doGenerate: [
					toolCalls({ name: "bash", input: { command: "env" } }),
					answer(`The key is ${apiKey}.`),
				],
			});

			const result = await executeRun(deps(model, { createModel: neverOurs, ownModel: own(model) }), runId);
			expect(result).toMatchObject({ status: "succeeded" });

			const steps = await listRunSteps(db, userId, runId);
			expect(steps[0]?.toolResults[0]?.output).toContain("HOME=");
			expect(steps[0]?.toolResults[0]?.output).not.toContain("[hidden]");
			expect(JSON.stringify(steps)).not.toContain(apiKey);
			expect((await listMessages(db, userId, chatId)).at(-1)?.content).toBe("The key is [hidden].");
			expect((await listRuns(db, userId, chatId))[0]?.modelCost).toBe(14);
		});

		it("fails with the provider's reason and never turns to our model", async () => {
			const { userId, chatId, runId } = await ownRun();
			const model = new MockLanguageModelV4({
				doGenerate: async () => {
					throw new Error(`401 ${apiKey}`);
				},
			});

			const result = await executeRun(deps(model, { createModel: neverOurs, ownModel: own(model) }), runId);
			expect(result).toMatchObject({ status: "failed" });
			const [row] = await listRuns(db, userId, chatId);
			expect(row?.error).toBe("Your provider rejected the API key.");
		});

		it("fails when the model cannot be loaded, without starting a sandbox", async () => {
			const { userId, chatId, runId } = await ownRun();
			const gone = async () => {
				throw new Error("The model this message used was removed.");
			};
			const result = await executeRun(
				deps(new MockLanguageModelV4(), { createModel: neverOurs, ownModel: gone }),
				runId,
			);
			expect(result).toMatchObject({ status: "failed" });
			expect(spy.created).toBe(0);
			expect((await listRuns(db, userId, chatId))[0]?.error).toContain("was removed");
		});

		it("fails when this server has no support for it", async () => {
			const { runId } = await ownRun();
			const result = await executeRun(deps(new MockLanguageModelV4(), { createModel: neverOurs }), runId);
			expect(result).toMatchObject({ status: "failed" });
			expect(spy.created).toBe(0);
		});
	});

	it("shows the model's output while it works, with secrets removed, and clears it after", async () => {
		const { userId, chatId, runId } = await setup({ env: { API_KEY: "s3cr3t-key-value" } });
		let release = () => {};
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const model = new MockLanguageModelV4({
			doStream: async () => {
				const first = model.doStreamCalls.length === 1;
				if (first) {
					return asStream(
						toolCalls({ name: "write", input: { path: "a.txt", content: "a" } }),
						"Thinking about s3cr3t-key-value before I write the file",
					);
				}
				await held;
				return asStream(answer("Done."));
			},
		});
		const seen: string[] = [];
		const watching = setInterval(async () => {
			const row = await getRunLive(db, userId, chatId, runId);
			if (row?.live) seen.push(JSON.stringify(row.live));
		}, 20);
		setTimeout(release, 1500);

		const result = await executeRun(deps(model, { liveUpdates: true }), runId);
		clearInterval(watching);

		expect(result).toMatchObject({ status: "succeeded" });
		expect(seen.join()).not.toContain("s3cr3t-key-value");
		expect(await getRunLive(db, userId, chatId, runId)).toEqual({ status: "succeeded", live: null });
		const [step] = await listRunSteps(db, userId, runId);
		expect(step?.reasoning).toBe("Thinking about [hidden] before I write the file");
		expect(await getRunLive(db, await fixtures.user(), chatId, runId)).toBeNull();
	});

	it("tells a follow-up what earlier runs already did", async () => {
		const { userId, chatId, runId } = await setup({ message: "Add a memo" });
		await executeRun(
			deps(
				new MockLanguageModelV4({
					doGenerate: [
						toolCalls(
							{ name: "write", input: { path: "memo.txt", content: "hi" } },
							{ name: "bash", input: { command: "exit 4" } },
						),
						answer("Added it."),
					],
				}),
			),
			runId,
		);
		const next = await followUp(userId, chatId, "Now extend it");
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });

		await executeRun(deps(model), next.runId);

		const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt.at(-1));
		expect(prompt).toContain("<earlier_work>");
		expect(prompt).toContain("Changed: memo.txt");
		expect(prompt).toContain("exit 4 -> failed, exit code 4");
		expect(prompt).toContain("Now extend it");
		expect((await listMessages(db, userId, chatId)).map((m) => m.content)).toContain("Now extend it");
	});

	it("continues a chat from the earlier run's files, in a new sandbox", async () => {
		const { userId, chatId, runId, branch } = await setup({ message: "Start a memo" });
		const first = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "memo.txt", content: "from run one\n" } }),
				answer("Started the memo."),
			],
		});
		await executeRun(deps(first), runId);

		const next = await followUp(userId, chatId, "Now read it back");
		const second = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "read", input: { path: "memo.txt" } }),
				toolCalls({ name: "write", input: { path: "reply.txt", content: "read it\n" } }),
				answer("It says: from run one."),
			],
		});
		const secondDeps = deps(second);
		const result = await executeRun(secondDeps, next.runId);

		expect(result).toMatchObject({ claimed: true, status: "succeeded" });
		expect(secondDeps.driver).toBe(spy);
		expect(spy.created).toBe(1);

		expect(JSON.stringify(second.doGenerateCalls[0]?.prompt)).toContain("Started the memo.");
		expect(JSON.stringify(second.doGenerateCalls[1]?.prompt)).toContain("from run one");
		expect((await remote.git(`show ${branch}:memo.txt`)).stdout).toBe("from run one\n");
		expect((await remote.git(`log --format=%s ${branch}`)).stdout).toBe(
			"WIP: Now read it back\nWIP: Start a memo\ninitial\n",
		);
	});

	it("does not start a run that cannot be claimed, and never creates a sandbox", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [answer("unused")] });

		const finished = await setup();
		await executeRun(deps(new MockLanguageModelV4({ doGenerate: [answer("done")] })), finished.runId);
		const again = deps(model);
		expect(await executeRun(again, finished.runId)).toEqual({ claimed: false, reason: "not_queued" });

		const pair = await setup();
		const second = await followUp(pair.userId, pair.chatId, "later");
		const waiting = deps(model);
		expect(await executeRun(waiting, second.runId)).toEqual({ claimed: false, reason: "not_next" });

		await claimRun(db, pair.runId);
		expect(await executeRun(waiting, second.runId)).toEqual({ claimed: false, reason: "busy" });

		expect(await executeRun(waiting, crypto.randomUUID())).toEqual({ claimed: false, reason: "not_found" });
		expect(spy.created).toBe(0);
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	it("tells the agent when setup fails, and still runs it", async () => {
		const { runId } = await setup({ installCommand: "echo boom >&2; exit 3" });
		const model = new MockLanguageModelV4({ doGenerate: [answer("I will work around it.")] });

		const result = await executeRun(deps(model), runId);

		expect(result).toMatchObject({ status: "succeeded" });
		const prompt = systemPrompt(model);
		expect(prompt).toContain("failed (exit code 3)");
		expect(prompt).toContain("boom");
	});

	it("fails a run that hits the step limit, and keeps the work done", async () => {
		const { userId, chatId, runId, branch } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: async () => toolCalls({ name: "write", input: { path: "partial.txt", content: "half\n" } }),
		});

		const result = await executeRun(deps(model, { limits: { maxSteps: 2 } }), runId);

		expect(result).toEqual({ claimed: true, status: "failed", stopReason: "step-limit" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("step limit");
		expect((await listRunSteps(db, userId, runId)).length).toBe(2);
		expect((await remote.git(`show ${branch}:partial.txt`)).stdout).toBe("half\n");
	});

	it("fails a run when the model breaks, keeps the steps and the work, and cleans up", async () => {
		const { userId, chatId, runId, branch } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				if (model.doGenerateCalls.length === 1) {
					return toolCalls({ name: "write", input: { path: "before.txt", content: "kept\n" } });
				}
				throw new Error("the model API is down");
			},
		});

		const result = await executeRun(deps(model), runId);

		expect(result).toEqual({ claimed: true, status: "failed", stopReason: "error" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("the model API is down");
		expect((await listRunSteps(db, userId, runId)).length).toBe(1);
		expect((await remote.git(`show ${branch}:before.txt`)).stdout).toBe("kept\n");
		expect(spy.destroyed).toBe(1);
	});

	it("cancels a run when asked to stop, and keeps the work", async () => {
		const { userId, chatId, runId, branch } = await setup();
		const controller = new AbortController();
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				if (model.doGenerateCalls.length === 1) {
					return toolCalls({ name: "write", input: { path: "stopped.txt", content: "so far\n" } });
				}
				setTimeout(() => controller.abort(), 100);
				return slow(5000, answer("too late"))(options);
			},
		});

		const result = await executeRun(deps(model), runId, { signal: controller.signal });

		expect(result).toEqual({ claimed: true, status: "cancelled", stopReason: "aborted" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.status).toBe("cancelled");
		expect((await remote.git(`show ${branch}:stopped.txt`)).stdout).toBe("so far\n");
		expect(spy.destroyed).toBe(1);
	});

	it("fails a run whose changes are too big to commit, and says so", async () => {
		const { userId, chatId, runId, branch } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "bash", input: { command: "head -c 60000000 /dev/zero > huge.bin" } }),
				answer("Generated the data."),
			],
		});

		const result = await executeRun(deps(model), runId);

		expect(result).toMatchObject({ claimed: true, status: "failed", stopReason: "error" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("were not saved");
		expect(row?.error).toContain(".gitignore");
		expect((await listMessages(db, userId, chatId)).at(-1)?.content).toBe("Generated the data.");
		expect((await remote.git(`rev-parse --verify --quiet ${branch}`)).exitCode).not.toBe(0);
	}, 120_000);

	it("fails a run for a disconnected project without creating a sandbox", async () => {
		const { userId, chatId, projectId, runId } = await setup();
		await db.update(project).set({ installationId: null }).where(eq(project.id, projectId));
		const model = new MockLanguageModelV4({ doGenerate: [answer("unused")] });

		const result = await executeRun(deps(model), runId);

		expect(result).toMatchObject({ claimed: true, status: "failed", stopReason: "error" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("disconnected");
		expect(spy.created).toBe(0);
	});

	it("fails a run whose variables cannot be decrypted, without creating a sandbox", async () => {
		const { userId, chatId, runId } = await setup({ env: { API_KEY: "value-one" } });
		const model = new MockLanguageModelV4({ doGenerate: [answer("unused")] });

		const result = await executeRun(
			deps(model, { decryptEnvValue: () => { throw new Error("Unsupported secret format"); } }),
			runId,
		);

		expect(result).toMatchObject({ claimed: true, status: "failed" });
		expect((await listRuns(db, userId, chatId))[0]?.error).toContain("Unsupported secret format");
		expect(spy.created).toBe(0);
	});

	it("asks for a repository-scoped token and sends it only to git over https", async () => {
		const { projectId, runId } = await setup();
		const [projectRow] = await db.select().from(project).where(eq(project.id, projectId));
		const [installationRow] = await db
			.select()
			.from(installation)
			.where(eq(installation.id, projectRow?.installationId ?? 0));

		const calls: { command: string; env: Record<string, string> }[] = [];
		const base = { stderr: "", timedOut: false, truncated: false };
		const fake: Sandbox = {
			id: "fake",
			workdir: "/workspace",
			async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
				calls.push({ command, env: options?.env ?? {} });
				if (command.includes("ls-remote")) return { ...base, exitCode: 0, stdout: "" };
				if (command.includes("diff --cached --quiet")) return { ...base, exitCode: 1, stdout: "" };
				if (command.includes("wc -l") || command.includes("awk")) return { ...base, exitCode: 0, stdout: "1\n" };
				return { ...base, exitCode: 0, stdout: "abc123\n" };
			},
			async readFile() {
				return new Uint8Array();
			},
			async writeFile() {},
			async destroy() {},
		};
		const asked: unknown[] = [];

		const result = await executeRun(
			{
				...deps(new MockLanguageModelV4({ doGenerate: [answer("done")] })),
				driver: { name: "fake", create: async () => fake },
				repoUrl: (fullName) => `https://github.com/${fullName}.git`,
				githubToken: async (input) => {
					asked.push(input);
					return "ghs_scoped_token";
				},
			},
			runId,
		);

		expect(result).toMatchObject({ claimed: true, status: "succeeded" });
		expect(asked).toEqual([{ installationId: installationRow?.id, repository: projectRow?.fullName }]);

		const basic = Buffer.from("x-access-token:ghs_scoped_token").toString("base64");
		const withToken = calls.filter((call) => call.env.GIT_CONFIG_VALUE_0 === `Authorization: Basic ${basic}`);
		expect(withToken.map((call) => call.command.match(/\b(ls-remote|clone|push)\b/)?.[0])).toEqual([
			"ls-remote",
			"clone",
			"push",
		]);
		for (const call of calls) expect(call.command).not.toContain("ghs_scoped_token");
	});

	it("keeps the list of changed files up to date while the run works, and after it", async () => {
		const { userId, chatId, runId } = await setup();
		const seen: string[][] = [];
		const model = new MockLanguageModelV4({
			doGenerate: async () => {
				const count = model.doGenerateCalls.length;
				if (count === 1) return toolCalls({ name: "write", input: { path: "new.txt", content: "x\n" } });
				const [row] = await listRuns(db, userId, chatId);
				seen.push((row?.changedFiles ?? []).map((file) => `${file.status}:${file.path}`));
				if (count === 2) return toolCalls({ name: "bash", input: { command: "rm README.md" } });
				return answer("done");
			},
		});

		await executeRun(deps(model), runId);

		expect(seen[0]).toEqual(["added:new.txt"]);
		expect(seen[1]).toEqual(["added:new.txt", "deleted:README.md"]);
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.changedFiles).toEqual([
			{ path: "new.txt", status: "added" },
			{ path: "README.md", status: "deleted" },
		].sort((a, b) => a.path.localeCompare(b.path)));
	});

	it("stops a run in the middle of a long command when the user asks", async () => {
		const { userId, chatId, runId } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: async () => toolCalls({ name: "bash", input: { command: "sleep 60" } }),
		});
		setTimeout(() => void requestStop(db, userId, runId), 700);

		const started = Date.now();
		const result = await executeRun(deps(model, { stopPollMs: 100 }), runId);

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(result).toEqual({ claimed: true, status: "cancelled", stopReason: "aborted" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row).toMatchObject({ status: "cancelled", stopReason: "aborted" });
		expect(row?.stopRequestedAt).toBeInstanceOf(Date);
		expect(spy.destroyed).toBe(1);
	});

	it("continues a run after its worker crashed, and ignores the old worker when it wakes up", async () => {
		const { userId, chatId, runId, branch } = await setup();
		let release: () => void = () => {};
		const hung = new Promise<void>((resolve) => {
			release = resolve;
		});
		const zombieModel = new MockLanguageModelV4({
			doGenerate: async () => {
				if (zombieModel.doGenerateCalls.length === 1) {
					return toolCalls({ name: "write", input: { path: "a.txt", content: "one\n" } });
				}
				await hung;
				return answer("zombie answer");
			},
		});
		const first = executeRun(deps(zombieModel, { heartbeatMs: 600_000, checkpointEverySteps: 1 }), runId);
		const zombieSpy = spy;

		await waitFor(async () => (await listRunSteps(db, userId, runId)).length === 1);
		await waitFor(async () => (await remote.git(`show ${branch}:a.txt`)).exitCode === 0);

		// The worker is gone: its heartbeat is old and the sweeper puts the run back in the queue.
		await db
			.update(runTable)
			.set({ heartbeatAt: new Date(Date.now() - 2 * 3_600_000) })
			.where(eq(runTable.id, runId));
		await sweepStaleRuns(db, { staleMs: 3_600_000, maxAttempts: 3 });
		const [queued] = await listRuns(db, userId, chatId);
		expect(queued?.status).toBe("queued");

		const resumedModel = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "bash", input: { command: "cat a.txt" } }),
				answer("Finished from where it stopped."),
			],
		});
		const result = await executeRun(deps(resumedModel), runId);

		expect(result).toEqual({ claimed: true, status: "succeeded", stopReason: "completed" });
		expect(systemPrompt(resumedModel)).toContain("interrupted and restarted");
		expect(JSON.stringify(resumedModel.doGenerateCalls[1]?.prompt)).toContain("one");
		const steps = await listRunSteps(db, userId, runId);
		expect(steps.map((s) => s.stepIndex)).toEqual([0, 1, 2]);
		const [row] = await db.select().from(runTable).where(eq(runTable.id, runId));
		expect(row?.attempts).toBe(2);

		release();
		expect(await first).toMatchObject({ claimed: true, status: "failed" });
		const [after] = await listRuns(db, userId, chatId);
		expect(after?.status).toBe("succeeded");
		const answers = (await listMessages(db, userId, chatId)).filter((m) => m.role === "assistant");
		expect(answers.map((m) => m.content)).toEqual(["Finished from where it stopped."]);
		expect(zombieSpy.destroyed).toBe(1);
	});

	it("fails a run whose workspace grows past the disk limit, and keeps what it has", async () => {
		const { userId, chatId, runId } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: async (options) => {
				if (model.doGenerateCalls.length === 1) {
					return toolCalls({ name: "bash", input: { command: "head -c 5000000 /dev/zero > big.bin" } });
				}
				return slow(10_000, answer("too late"))(options);
			},
		});

		const result = await executeRun(deps(model, { maxDiskMb: 2 }), runId);

		expect(result).toEqual({ claimed: true, status: "failed", stopReason: "error" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("grew past 2 MB");
		expect(spy.destroyed).toBe(1);
	});

	it("does not start a run when its user is already running too many", async () => {
		const { userId, projectId, runId: firstRun } = await setup();
		const other = await createChat(db, {
			userId,
			projectId,
			baseBranch: "main",
			model: "deepseek-v4-pro",
			content: "A second chat",
		});
		if (!other.ok) throw new Error(other.reason);
		expect((await claimRun(db, firstRun)).ok).toBe(true);

		const model = new MockLanguageModelV4({ doGenerate: async () => answer("unused") });
		const result = await executeRun(deps(model, { maxRunningPerUser: 1 }), other.runId);

		expect(result).toEqual({ claimed: false, reason: "user_busy" });
		expect(spy.created).toBe(0);
		expect(model.doGenerateCalls).toHaveLength(0);
	});

	it("saves what the model and the sandbox cost", async () => {
		const { userId, chatId, runId } = await setup();
		const model = new MockLanguageModelV4({ doGenerate: [answer("done")] });

		await executeRun(deps(model, { sandboxHourlyCost: { plain: 3_600_000_000, browser: 0 } }), runId);

		const [row] = await listRuns(db, userId, chatId);
		// 100 new input and 20 output tokens at the Pro price, doubled in peak hours.
		expect([106, 211]).toContain(row?.modelCost);
		expect(row?.sandboxCost).toBeGreaterThan(0);
		const [step] = await listRunSteps(db, userId, runId);
		expect(step?.cost).toBe(row?.modelCost);
	});

	it("stops a run that reaches its spending cap, keeping its work", async () => {
		const { userId, chatId, runId } = await setup();
		const model = new MockLanguageModelV4({
			doGenerate: async () => toolCalls({ name: "write", input: { path: "notes.txt", content: "x\n" } }),
		});

		const result = await executeRun(deps(model, { limits: { maxCost: 150 } }), runId);

		expect(result).toMatchObject({ status: "failed", stopReason: "cost-limit" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.error).toContain("spending cap");
		expect(row?.changedFiles).toEqual([{ path: "notes.txt", status: "added" }]);
	});

	async function moveMain(file: string, text: string) {
		const box = await docker.create({ image, memoryMb: 512 });
		try {
			const script = `git clone -q ${remote.url} . && printf '%s\\n' '${text}' > ${file} && git add -A && git -c user.name=M -c user.email=m@example.test commit -qm main && git push -q origin HEAD:main`;
			expect((await box.exec(script)).exitCode).toBe(0);
		} finally {
			await box.destroy();
		}
	}

	async function updateFromBase(userId: string, chatId: string) {
		const sent = await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content: "Update from main", updateBase: true });
		if (!sent.ok) throw new Error(sent.reason);
		return sent.runId;
	}

	const writes = (path: string, content: string) =>
		new MockLanguageModelV4({
			doGenerate: [toolCalls({ name: "write", input: { path, content } }), answer("done")],
		});

	it("merges a base that moved on without asking the model, when nothing conflicts", async () => {
		const { userId, chatId, runId, branch } = await setup();
		await executeRun(deps(writes("chat-only.txt", "mine\n")), runId);
		await moveMain(`main-only-${randomBytes(3).toString("hex")}.txt`, "theirs");
		const model = new MockLanguageModelV4({ doGenerate: [] });

		const result = await executeRun(deps(model), await updateFromBase(userId, chatId));

		expect(result).toMatchObject({ status: "succeeded" });
		expect(model.doGenerateCalls).toHaveLength(0);
		expect((await remote.git(`log -1 --format=%P ${branch}`)).stdout.trim().split(" ")).toHaveLength(2);
		expect((await listMessages(db, userId, chatId)).at(-1)?.content).toContain("no conflicts");
	});

	it.each([
		["resolves them", "both\n", "succeeded", "both\n"],
		["leaves markers behind", "<<<<<<< HEAD\nmine\n", "failed", "mine\n"],
	])("gives conflicts to the agent, which %s", async (_how, resolution, status, onBranch) => {
		const file = `shared-${randomBytes(3).toString("hex")}.txt`;
		const { userId, chatId, runId, branch } = await setup();
		await executeRun(deps(writes(file, "mine\n")), runId);
		await moveMain(file, "theirs");
		const model = writes(file, resolution);

		const result = await executeRun(deps(model), await updateFromBase(userId, chatId));

		expect(result).toMatchObject({ status });
		expect(systemPrompt(model)).toContain(file);
		expect((await remote.git(`show ${branch}:${file}`)).stdout).toBe(onBranch);
	});

	it("closes the issue the chat was started from in its pull request", async () => {
		const { chatId, runId } = await setup();
		await db.update(chat).set({ issueNumber: 7 }).where(eq(chat.id, chatId));
		const bodies: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: [toolCalls({ name: "write", input: { path: "fix.txt", content: "x\n" } }), answer("Fixed.")],
		});

		await executeRun(
			deps(model, {
				openPullRequest: async (input) => {
					bodies.push(input.body);
					return { number: 3, url: "https://github.com/acme/app/pull/3" };
				},
			}),
			runId,
		);

		expect(bodies[0]).toContain("Closes #7");
		expect(bodies[0]).toContain("fix.txt");
	});

	it("only reads and proposes in a planning run, and pushes nothing", async () => {
		const { userId, chatId, runId, branch } = await setup({ installCommand: "echo x > setup.txt" });
		await db.update(runTable).set({ planOnly: true }).where(eq(runTable.id, runId));
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "sneaky.txt", content: "x\n" } }),
				answer("Plan: edit README.md."),
			],
		});

		const result = await executeRun(deps(model), runId);

		expect(result).toMatchObject({ status: "succeeded" });
		expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name).sort()).toEqual(["grep", "list", "read"]);
		expect((await remote.git(`rev-parse --verify ${branch}`)).exitCode).not.toBe(0);
		expect((await listMessages(db, userId, chatId)).at(-1)?.content).toBe("Plan: edit README.md.");
		expect((await getChatForUser(db, userId, chatId))?.workingBranch).toBeNull();
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.changedFiles).toEqual([]);
	});

	it("puts a run back in the queue when there is no room for its sandbox", async () => {
		const { userId, chatId, runId } = await setup();
		const full: SandboxDriver = {
			name: "full",
			create: async () => {
				throw new SandboxCapacityError("Total memory limit exceeded");
			},
		};
		const model = new MockLanguageModelV4({ doGenerate: [answer("unused")] });

		const result = await executeRun(deps(model, { driver: full }), runId);

		expect(result).toEqual({ claimed: false, reason: "no_capacity" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row).toMatchObject({ status: "queued", startedAt: null, error: null });
		// A newer run of the same user waits behind it, even though nothing else is running.
		const projectId = (await getChatForUser(db, userId, chatId))?.projectId ?? "";
		const newer = await createChat(db, { userId, projectId, baseBranch: "main", model: "deepseek-v4-pro", content: "Next" });
		if (!newer.ok) throw new Error(newer.reason);
		expect(await claimRun(db, newer.runId)).toEqual({ ok: false, reason: "waiting_turn" });
		expect(await claimRun(db, runId)).toMatchObject({ ok: true, run: { attempt: 1 } });
	});

	it("runs the tests when asked, records the result, and does not change the run's status", async () => {
		const { userId, chatId, runId } = await setup({
			testCommand: "echo ok-$API_KEY; echo bad >&2; exit 2",
			verify: true,
			env: { API_KEY: "s3cr3t-key-value" },
		});
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });

		const result = await executeRun(deps(model), runId);

		expect(result).toEqual({ claimed: true, status: "succeeded", stopReason: "completed" });
		const [row] = await listRuns(db, userId, chatId);
		expect(row?.verification).toMatchObject({ command: expect.stringContaining("exit 2"), exitCode: 2, timedOut: false });
		expect(row?.verification?.output).toContain("bad");
		expect(row?.verification?.output).not.toContain("s3cr3t-key-value");
	});

	it("does not run the tests unless asked, or when the project has no test command", async () => {
		const notAsked = await setup({ testCommand: "echo ran > ran.txt" });
		const noCommand = await setup({ verify: true });
		const model = () => new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });

		await executeRun(deps(model()), notAsked.runId);
		await executeRun(deps(model()), noCommand.runId);

		expect((await listRuns(db, notAsked.userId, notAsked.chatId))[0]?.verification).toBeNull();
		expect((await listRuns(db, noCommand.userId, noCommand.chatId))[0]?.verification).toBeNull();
		expect((await remote.git(`show ${notAsked.branch}:ran.txt`)).exitCode).not.toBe(0);
	});

	it("stops the tests when the user asks to stop", async () => {
		const { userId, chatId, runId } = await setup({ testCommand: "sleep 60", verify: true });
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });
		setTimeout(() => void requestStop(db, userId, runId), 1500);

		const started = Date.now();
		await executeRun(deps(model, { stopPollMs: 100 }), runId);

		expect(Date.now() - started).toBeLessThan(20_000);
		expect((await listRuns(db, userId, chatId))[0]?.verification).toBeNull();
	});

	it("opens one PR for the chat after the work is saved, and not again for later messages", async () => {
		const { userId, chatId, runId, branch } = await setup({
			message: "Add a notes file\nwith some detail",
			testCommand: "exit 0",
			verify: true,
		});
		const requests: PullRequestInput[] = [];
		const openPullRequest: RunnerDeps["openPullRequest"] = async (input) => {
			requests.push(input);
			return { number: 9, url: "https://github.com/o/r/pull/9" };
		};
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "notes.md", content: "hi\n" } }),
				answer("I added notes.md."),
			],
		});

		await executeRun(deps(model, { openPullRequest }), runId);

		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({ head: branch, base: "main", title: "Add a notes file" });
		expect(requests[0]?.body).toContain("I added notes.md.");
		expect(requests[0]?.body).toContain("`notes.md` (added)");
		expect(requests[0]?.body).toContain("Passed");
		const [row] = await db.select().from(chat).where(eq(chat.id, chatId));
		expect(row).toMatchObject({ pullRequestNumber: 9, pullRequestUrl: "https://github.com/o/r/pull/9" });

		const next = await followUp(userId, chatId, "One more thing");
		await executeRun(deps(new MockLanguageModelV4({ doGenerate: async () => answer("Done.") }), { openPullRequest }), next.runId);
		expect(requests).toHaveLength(1);
	});

	it("keeps the run succeeded when the PR cannot be opened, and records why", async () => {
		const { userId, chatId, runId } = await setup();
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });

		const result = await executeRun(
			deps(model, {
				openPullRequest: async () => {
					throw new Error("Resource not accessible by integration");
				},
			}),
			runId,
		);

		expect(result).toMatchObject({ claimed: true, status: "succeeded" });
		const [row] = await db.select().from(chat).where(eq(chat.id, chatId));
		expect(row?.pullRequestNumber).toBeNull();
		expect(row?.pullRequestError).toContain("not accessible");
		expect((await listRuns(db, userId, chatId))[0]?.status).toBe("succeeded");
	});

	it("opens no PR when there is nothing to propose", async () => {
		const { chatId, runId } = await setup();
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("Nothing to change.") });

		await executeRun(deps(model, { openPullRequest: async () => null }), runId);

		const [row] = await db.select().from(chat).where(eq(chat.id, chatId));
		expect(row).toMatchObject({ pullRequestNumber: null, pullRequestError: null });
	});

	it("stops a run that is still installing dependencies", async () => {
		const { userId, runId } = await setup({ installCommand: "sleep 60" });
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("unused") });
		setTimeout(() => void requestStop(db, userId, runId), 700);

		const started = Date.now();
		const result = await executeRun(deps(model, { stopPollMs: 100 }), runId);

		expect(Date.now() - started).toBeLessThan(15_000);
		expect(result).toMatchObject({ claimed: true, status: "cancelled" });
	});
});
