import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	addMessage,
	cancelRun,
	chat,
	claimRun,
	createChat,
	deleteChat,
	exportAccountData,
	finishRun,
	isStopRequested,
	listStalledQueued,
	listMessages,
	listRuns,
	listRunActivity,
	listRunSteps,
	getChatForUser,
	loadRunContext,
	message,
	projectEnvVar,
	recordStep,
	requestStop,
	run,
	runStep,
	setChangedFiles,
	setPullRequest,
	setPullRequestError,
	setVerification,
	setWorkingBranchIfUnset,
	type StepRecord,
	sweepStaleRuns,
	touchRun,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function owner() {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	return { userId, projectId };
}

async function start(userId: string, projectId: string, content = "Fix the test") {
	const result = await createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "deepseek-v4-pro",
		content,
	});
	if (!result.ok) throw new Error(`createChat failed: ${result.reason}`);
	return result;
}

async function reply(userId: string, chatId: string) {
	const result = await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content: "More" });
	if (!result.ok) throw new Error(`addMessage failed: ${result.reason}`);
	return result;
}

// A chat with a running first run.
async function running() {
	const { userId, projectId } = await owner();
	const created = await start(userId, projectId);
	const claimed = await claimRun(db, created.runId);
	if (!claimed.ok) throw new Error(`claimRun failed: ${claimed.reason}`);
	return { userId, projectId, ...created };
}

const step = (stepIndex: number, overrides: Partial<StepRecord> = {}): StepRecord => ({
	stepIndex,
	finishReason: "tool-calls",
	text: "",
	toolCalls: [{ id: `c${stepIndex}`, name: "list", input: {} }],
	toolResults: [{ id: `c${stepIndex}`, name: "list", output: "a.ts", isError: false }],
	inputTokens: 100,
	outputTokens: 20,
	...overrides,
});

async function runRow(runId: string) {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error("run missing");
	return row;
}

describe("claimRun", () => {
	it("moves a queued run to running and returns what the worker needs", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		const claimed = await claimRun(db, created.runId);
		expect(claimed).toEqual({
			ok: true,
			run: {
				id: created.runId,
				chatId: created.chatId,
				userId,
				messageId: created.messageId,
				model: "deepseek-v4-pro",
				attempt: 1,
			},
		});

		const row = await runRow(created.runId);
		expect(row.status).toBe("running");
		expect(row.startedAt).toBeInstanceOf(Date);
	});

	it("does not claim a run twice, or a run that does not exist", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		await claimRun(db, created.runId);

		expect(await claimRun(db, created.runId)).toEqual({ ok: false, reason: "not_queued" });
		expect(await claimRun(db, crypto.randomUUID())).toEqual({ ok: false, reason: "not_found" });
	});

	it("lets exactly one of several simultaneous claims win", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		const results = await Promise.all(
			Array.from({ length: 6 }, () => claimRun(db, created.runId)),
		);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(results.filter((result) => !result.ok)).toHaveLength(5);
	});

	it("runs a chat's runs in order, one at a time", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId);
		const second = await reply(userId, first.chatId);

		expect(await claimRun(db, second.runId)).toEqual({ ok: false, reason: "not_next" });
		expect((await claimRun(db, first.runId)).ok).toBe(true);
		expect(await claimRun(db, second.runId)).toEqual({ ok: false, reason: "busy" });

		await finishRun(db, first.runId, { status: "succeeded", stopReason: "completed" });
		expect((await claimRun(db, second.runId)).ok).toBe(true);
	});

	it("is not held up by a cancelled run ahead of it", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId);
		const second = await reply(userId, first.chatId);

		await cancelRun(db, userId, first.runId);
		expect((await claimRun(db, second.runId)).ok).toBe(true);
	});

	it("does not make chats wait for each other", async () => {
		const { userId, projectId } = await owner();
		const a = await start(userId, projectId);
		const b = await start(userId, projectId);

		expect((await claimRun(db, a.runId)).ok).toBe(true);
		expect((await claimRun(db, b.runId)).ok).toBe(true);
	});
});

describe("recordStep", () => {
	it("saves the step and adds its tokens to the run", async () => {
		const { runId } = await running();

		expect(await recordStep(db, runId, step(0))).toEqual({ recorded: true });
		expect(await recordStep(db, runId, step(1, { inputTokens: 300, outputTokens: 50 }))).toEqual({
			recorded: true,
		});

		const row = await runRow(runId);
		expect(row.inputTokens).toBe(400);
		expect(row.outputTokens).toBe(70);
	});

	it("ignores a step it already has, without counting its tokens twice", async () => {
		const { runId } = await running();
		await recordStep(db, runId, step(0));

		expect(await recordStep(db, runId, step(0, { text: "retry" }))).toEqual({ recorded: false });

		const row = await runRow(runId);
		expect(row.inputTokens).toBe(100);
		const saved = await db.select().from(runStep).where(eq(runStep.runId, runId));
		expect(saved).toHaveLength(1);
		expect(saved[0]?.text).toBe("");
	});

	it("keeps simultaneous writes of the same step to one", async () => {
		const { runId } = await running();
		const results = await Promise.all(
			Array.from({ length: 5 }, () => recordStep(db, runId, step(0))),
		);

		expect(results.filter((result) => result.recorded)).toHaveLength(1);
		expect((await runRow(runId)).inputTokens).toBe(100);
	});

	it("only saves steps for a run that is running", async () => {
		const { userId, projectId } = await owner();
		const queued = await start(userId, projectId);
		expect(await recordStep(db, queued.runId, step(0))).toEqual({ recorded: false });

		const { runId } = await running();
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });
		expect(await recordStep(db, runId, step(0))).toEqual({ recorded: false });
		expect(await recordStep(db, crypto.randomUUID(), step(0))).toEqual({ recorded: false });
	});

	it("keeps tool calls and results, and returns steps in order to their owner only", async () => {
		const { userId, runId } = await running();
		await recordStep(db, runId, step(1, { text: "second" }));
		await recordStep(
			db,
			runId,
			step(0, {
				toolCalls: [{ id: "x", name: "read", input: { path: "a.ts" } }],
				toolResults: [{ id: "x", name: "read", output: "File not found: a.ts", isError: true }],
			}),
		);

		const steps = await listRunSteps(db, userId, runId);
		expect(steps.map((s) => s.stepIndex)).toEqual([0, 1]);
		expect(steps[0]?.toolCalls).toEqual([{ id: "x", name: "read", input: { path: "a.ts" } }]);
		expect(steps[0]?.toolResults[0]).toMatchObject({ isError: true, output: "File not found: a.ts" });

		const other = await fixtures.user();
		expect(await listRunSteps(db, other, runId)).toEqual([]);
	});
});

describe("finishRun", () => {
	it("completes the run and saves the agent's answer as an assistant message", async () => {
		const { userId, chatId, runId } = await running();

		const result = await finishRun(db, runId, {
			status: "succeeded",
			stopReason: "completed",
			text: "  I fixed it.  ",
		});
		expect(result.ok).toBe(true);

		const row = await runRow(runId);
		expect(row).toMatchObject({ status: "succeeded", stopReason: "completed", error: null });
		expect(row.finishedAt).toBeInstanceOf(Date);

		const messages = await listMessages(db, userId, chatId);
		expect(messages.map((m) => [m.role, m.content])).toEqual([
			["user", "Fix the test"],
			["assistant", "I fixed it."],
		]);
		const assistant = (await db.select().from(message).where(eq(message.runId, runId)))[0];
		expect(assistant?.role).toBe("assistant");
		expect(messages.map((m) => m.runId)).toEqual([null, runId]);
	});

	it("records why a run failed or was stopped, and keeps any partial answer", async () => {
		const failed = await running();
		await finishRun(db, failed.runId, {
			status: "failed",
			stopReason: "step-limit",
			error: "Stopped: step limit reached",
			text: "Got halfway.",
		});
		expect(await runRow(failed.runId)).toMatchObject({
			status: "failed",
			stopReason: "step-limit",
			error: "Stopped: step limit reached",
		});
		expect(await listMessages(db, failed.userId, failed.chatId)).toHaveLength(2);

		const stopped = await running();
		await finishRun(db, stopped.runId, { status: "cancelled", stopReason: "aborted" });
		expect((await runRow(stopped.runId)).status).toBe("cancelled");
		expect(await listMessages(db, stopped.userId, stopped.chatId)).toHaveLength(1);
	});

	it("adds no message when there is nothing to say", async () => {
		const { userId, chatId, runId } = await running();
		const result = await finishRun(db, runId, {
			status: "succeeded",
			stopReason: "completed",
			text: "   ",
		});
		expect(result).toEqual({ ok: true, messageId: null });
		expect(await listMessages(db, userId, chatId)).toHaveLength(1);
	});

	it("finishes a run only once, and only if it is running", async () => {
		const { runId } = await running();
		const outcome = { status: "succeeded", stopReason: "completed" } as const;
		expect((await finishRun(db, runId, outcome)).ok).toBe(true);
		expect(await finishRun(db, runId, outcome)).toEqual({ ok: false, reason: "not_running" });

		const { userId, projectId } = await owner();
		const queued = await start(userId, projectId);
		expect(await finishRun(db, queued.runId, outcome)).toEqual({ ok: false, reason: "not_running" });
		expect(await finishRun(db, crypto.randomUUID(), outcome)).toEqual({ ok: false, reason: "not_found" });
	});

	it("frees the chat for the next run and moves it to the top of the list", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId);
		const second = await reply(userId, first.chatId);
		await claimRun(db, first.runId);

		await new Promise((resolve) => setTimeout(resolve, 20));
		const before = (await db.select().from(chat).where(eq(chat.id, first.chatId)))[0]?.updatedAt;
		await finishRun(db, first.runId, { status: "succeeded", stopReason: "completed", text: "done" });
		const after = (await db.select().from(chat).where(eq(chat.id, first.chatId)))[0]?.updatedAt;

		expect(after && before && after > before).toBe(true);
		expect((await claimRun(db, second.runId)).ok).toBe(true);
	});

	it("rejects a stop reason that is not in the list", async () => {
		const { runId } = await running();
		const bad = db
			.update(run)
			.set({ stopReason: "banana" as unknown as "completed" })
			.where(eq(run.id, runId));
		await expect(bad).rejects.toMatchObject({ cause: { code: "23514" } });
	});
});

describe("runs and the rest of the data", () => {
	it("shows tokens and the stop reason with the chat's runs", async () => {
		const { userId, chatId, runId } = await running();
		await recordStep(db, runId, step(0));
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });

		const [row] = await listRuns(db, userId, chatId);
		expect(row).toMatchObject({
			status: "succeeded",
			stopReason: "completed",
			inputTokens: 100,
			outputTokens: 20,
		});
	});

	it("deletes a chat's steps with the chat", async () => {
		const { userId, chatId, runId } = await running();
		await recordStep(db, runId, step(0));
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed", text: "ok" });

		expect(await deleteChat(db, userId, chatId)).toEqual({ ok: true });
		expect(await db.select().from(runStep).where(eq(runStep.runId, runId))).toEqual([]);
	});

	it("includes steps and the assistant's messages in the account export, for the owner only", async () => {
		const mine = await running();
		await recordStep(db, mine.runId, step(0));
		await finishRun(db, mine.runId, { status: "succeeded", stopReason: "completed", text: "all done" });
		const other = await running();
		await recordStep(db, other.runId, step(0));

		const data = await exportAccountData(db, mine.userId);
		expect(data?.runSteps.map((s) => s.runId)).toEqual([mine.runId]);
		expect(data?.messages.map((m) => m.content)).toContain("all done");
		expect(data?.runs[0]).toMatchObject({ inputTokens: 100, stopReason: "completed" });
	});
});

describe("loadRunContext", () => {
	it("gathers what a worker needs for one run", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId, "First question");
		await db.insert(projectEnvVar).values([
			{ projectId, name: "B_KEY", valueEncrypted: "v1.b" },
			{ projectId, name: "A_KEY", valueEncrypted: "v1.a" },
		]);

		const context = await loadRunContext(db, first.runId);
		expect(context).toMatchObject({
			run: { id: first.runId, chatId: first.chatId, userId, model: "deepseek-v4-pro" },
			chat: { id: first.chatId, baseBranch: "main", workingBranch: null },
			project: {
				id: projectId,
				installCommand: null,
				testCommand: null,
				startCommand: null,
				appPort: null,
			},
		});
		expect(context?.project.installationId).not.toBeNull();
		expect(context?.messages).toEqual([{ role: "user", content: "First question" }]);
		expect(context?.envVars).toEqual([
			{ name: "A_KEY", valueEncrypted: "v1.a" },
			{ name: "B_KEY", valueEncrypted: "v1.b" },
		]);
	});

	it("includes earlier answers but not messages sent after this run's", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId, "First question");
		await claimRun(db, first.runId);
		await finishRun(db, first.runId, {
			status: "succeeded",
			stopReason: "completed",
			text: "First answer",
		});
		const second = await reply(userId, first.chatId);
		const third = await reply(userId, first.chatId);

		const context = await loadRunContext(db, second.runId);
		expect(context?.messages.map((m) => [m.role, m.content])).toEqual([
			["user", "First question"],
			["assistant", "First answer"],
			["user", "More"],
		]);
		expect((await loadRunContext(db, third.runId))?.messages).toHaveLength(4);
	});

	it("returns nothing for a run that does not exist", async () => {
		expect(await loadRunContext(db, crypto.randomUUID())).toBeNull();
	});
});

describe("setWorkingBranchIfUnset", () => {
	it("records the branch once and keeps the first one", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		await setWorkingBranchIfUnset(db, created.chatId, "nullfuse/chat-aaaa");
		await setWorkingBranchIfUnset(db, created.chatId, "nullfuse/chat-bbbb");

		const [row] = await db.select().from(chat).where(eq(chat.id, created.chatId));
		expect(row?.workingBranch).toBe("nullfuse/chat-aaaa");
	});
});

describe("changed files", () => {
	const files = [
		{ path: "src/a.ts", status: "modified" as const },
		{ path: "new.txt", status: "added" as const },
	];

	it("are saved while the run is running, and shown with the chat's runs", async () => {
		const { userId, chatId, runId } = await running();
		await setChangedFiles(db, runId, files);

		const [row] = await listRuns(db, userId, chatId);
		expect(row?.changedFiles).toEqual(files);
	});

	it("are kept when the run finishes, and not changed afterwards", async () => {
		const { userId, chatId, runId } = await running();
		await setChangedFiles(db, runId, files);
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });
		await setChangedFiles(db, runId, []);

		expect((await listRuns(db, userId, chatId))[0]?.changedFiles).toEqual(files);
	});
});

describe("stopping a run", () => {
	it("can be requested by the owner for a running run, any number of times", async () => {
		const { userId, runId } = await running();
		expect(await isStopRequested(db, runId)).toBe(false);

		expect(await requestStop(db, userId, runId)).toBe(true);
		const first = (await runRow(runId)).stopRequestedAt;
		expect(first).toBeInstanceOf(Date);
		expect(await isStopRequested(db, runId)).toBe(true);

		expect(await requestStop(db, userId, runId)).toBe(true);
		expect((await runRow(runId)).stopRequestedAt).toEqual(first);
	});

	it("cannot be requested by someone else, or for a run that is not running", async () => {
		const mine = await running();
		const other = await fixtures.user();
		expect(await requestStop(db, other, mine.runId)).toBe(false);
		expect(await isStopRequested(db, mine.runId)).toBe(false);

		const { userId, projectId } = await owner();
		const queued = await start(userId, projectId);
		expect(await requestStop(db, userId, queued.runId)).toBe(false);

		await finishRun(db, mine.runId, { status: "succeeded", stopReason: "completed" });
		expect(await requestStop(db, mine.userId, mine.runId)).toBe(false);
		expect(await requestStop(db, userId, crypto.randomUUID())).toBe(false);
	});
});

describe("listRunActivity", () => {
	it("returns each step with short labels and previews, in order", async () => {
		const { userId, runId } = await running();
		await recordStep(
			db,
			runId,
			step(1, {
				text: "t".repeat(2000),
				toolCalls: [
					{ id: "a", name: "read", input: { path: "src/a.ts" } },
					{ id: "b", name: "bash", input: { command: "pnpm test" } },
					{ id: "c", name: "grep", input: { pattern: "needle", path: "src" } },
					{ id: "d", name: "list", input: {} },
				],
				toolResults: [
					{ id: "a", name: "read", output: "x".repeat(5000), isError: false },
					{ id: "b", name: "bash", output: "failed", isError: true },
				],
			}),
		);
		await recordStep(db, runId, step(0, { text: "first" }));

		const steps = await listRunActivity(db, userId, [runId]);
		expect(steps.map((s) => s.stepIndex)).toEqual([0, 1]);

		const second = steps[1];
		expect(second?.text).toHaveLength(600);
		expect(second?.calls).toEqual([
			{ id: "a", name: "read", label: "src/a.ts" },
			{ id: "b", name: "bash", label: "pnpm test" },
			{ id: "c", name: "grep", label: "src" },
			{ id: "d", name: "list", label: "" },
		]);
		expect(second?.results).toHaveLength(2);
		expect(second?.results[0]?.preview).toHaveLength(400);
		expect(second?.results[1]).toEqual({ id: "b", isError: true, preview: "failed" });
		expect(second?.inputTokens).toBe(100);
	});

	it("returns no calls or results for a step without tools", async () => {
		const { userId, runId } = await running();
		await recordStep(db, runId, step(0, { toolCalls: [], toolResults: [], text: "done" }));

		const [only] = await listRunActivity(db, userId, [runId]);
		expect(only).toMatchObject({ calls: [], results: [], text: "done" });
	});

	it("covers several runs, and only the owner's", async () => {
		const a = await running();
		const b = await running();
		await recordStep(db, a.runId, step(0));
		await recordStep(db, b.runId, step(0));

		const both = await listRunActivity(db, a.userId, [a.runId, b.runId]);
		expect(both.map((s) => s.runId)).toEqual([a.runId]);
		expect(await listRunActivity(db, a.userId, [])).toEqual([]);
	});
});

const longAgo = () => new Date(Date.now() - 10 * 60_000);
const age = (runId: string, column: "heartbeatAt" | "updatedAt" = "heartbeatAt") =>
	db.update(run).set({ [column]: longAgo() }).where(eq(run.id, runId));

describe("claim limits and attempts", () => {
	it("counts attempts and starts the heartbeat on every claim", async () => {
		const { runId } = await running();
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		expect(row?.attempts).toBe(1);
		expect(row?.heartbeatAt).toBeInstanceOf(Date);
	});

	it("keeps one user under their cap, even when claims arrive together", async () => {
		const { userId, projectId } = await owner();
		const runIds = await Promise.all(
			[1, 2, 3, 4].map(async (n) => (await start(userId, projectId, `Task ${n}`)).runId),
		);
		const results = await Promise.all(
			runIds.map((id) => claimRun(db, id, { maxRunningPerUser: 2 })),
		);
		expect(results.filter((r) => r.ok)).toHaveLength(2);
		expect(results.filter((r) => !r.ok && r.reason === "user_busy")).toHaveLength(2);
	});

	it("does not count other users' runs against the cap", async () => {
		const first = await owner();
		const second = await owner();
		const a = await start(first.userId, first.projectId);
		const b = await start(second.userId, second.projectId);
		expect((await claimRun(db, a.runId, { maxRunningPerUser: 1 })).ok).toBe(true);
		expect((await claimRun(db, b.runId, { maxRunningPerUser: 1 })).ok).toBe(true);
	});
});

describe("fencing", () => {
	it("ignores writes from an attempt that is no longer current", async () => {
		const { runId } = await running();
		await sweepStaleRunsAfterAging(runId);
		const second = await claimRun(db, runId);
		if (!second.ok) throw new Error(second.reason);
		expect(second.run.attempt).toBe(2);

		expect((await recordStep(db, runId, step(0), 1)).recorded).toBe(false);
		expect((await recordStep(db, runId, step(0), 2)).recorded).toBe(true);
		expect(await touchRun(db, runId, 1)).toBe(false);
		expect(await touchRun(db, runId, 2)).toBe(true);
		expect((await finishRun(db, runId, { status: "succeeded", stopReason: "completed" }, 1)).ok).toBe(false);
		expect((await finishRun(db, runId, { status: "succeeded", stopReason: "completed" }, 2)).ok).toBe(true);
	});
});

async function sweepStaleRunsAfterAging(runId: string) {
	await age(runId);
	const swept = await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
	expect(swept.find((r) => r.id === runId)?.action).toBe("requeued");
}

describe("sweepStaleRuns", () => {
	it("requeues a run whose worker stopped, and leaves live ones alone", async () => {
		const stale = await running();
		const live = await running();
		await age(stale.runId);
		const swept = await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
		expect(swept.find((r) => r.id === stale.runId)?.action).toBe("requeued");
		expect(swept.find((r) => r.id === live.runId)).toBeUndefined();
		const [row] = await db.select().from(run).where(eq(run.id, stale.runId));
		expect(row?.status).toBe("queued");
		expect(row?.startedAt).toBeInstanceOf(Date);
	});

	it("keeps the steps already recorded, so a restart can carry on after them", async () => {
		const { runId } = await running();
		await recordStep(db, runId, step(0));
		await age(runId);
		await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		expect(row?.inputTokens).toBe(100);
		const steps = await db.select().from(runStep).where(eq(runStep.runId, runId));
		expect(steps).toHaveLength(1);
	});

	it("fails a run that crashed too many times, with a message", async () => {
		const { runId } = await running();
		await db.update(run).set({ attempts: 3 }).where(eq(run.id, runId));
		await age(runId);
		const swept = await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
		expect(swept.find((r) => r.id === runId)?.action).toBe("failed");
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		expect(row?.status).toBe("failed");
		expect(row?.stopReason).toBe("error");
		expect(row?.error).toContain("stopped responding");
	});

	it("cancels instead of restarting a run the user asked to stop", async () => {
		const { userId, runId } = await running();
		await requestStop(db, userId, runId);
		await age(runId);
		const swept = await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
		expect(swept.find((r) => r.id === runId)?.action).toBe("cancelled");
		const [row] = await db.select().from(run).where(eq(run.id, runId));
		expect(row?.status).toBe("cancelled");
	});

	it("frees the chat so a queued follow-up can start after the sweep", async () => {
		const { userId, chatId, runId } = await running();
		const next = await reply(userId, chatId);
		await age(runId);
		await sweepStaleRuns(db, { staleMs: 60_000, maxAttempts: 3 });
		const first = await claimRun(db, runId);
		expect(first.ok).toBe(true);
		expect((await claimRun(db, next.runId)).ok).toBe(false);
	});
});

describe("listStalledQueued", () => {
	it("lists only the next queued run of each chat, and only when it has waited", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		const second = await reply(userId, created.chatId);
		expect((await listStalledQueued(db, { olderThanMs: 60_000 })).map((r) => r.id)).not.toContain(created.runId);

		await age(created.runId, "updatedAt");
		await age(second.runId, "updatedAt");
		const ids = (await listStalledQueued(db, { olderThanMs: 60_000 })).map((r) => r.id);
		expect(ids).toContain(created.runId);
		expect(ids).not.toContain(second.runId);
	});
});

describe("verification", () => {
	const result = { command: "pnpm test", exitCode: 1, timedOut: false, durationMs: 2500, output: "1 failed" };

	it("is off unless asked for, and loaded for the worker", async () => {
		const { userId, projectId } = await owner();
		const plain = await start(userId, projectId);
		const asked = await createChat(db, {
			userId,
			projectId,
			baseBranch: "main",
			model: "deepseek-v4-pro",
			content: "Fix it",
			verify: true,
		});
		if (!asked.ok) throw new Error(asked.reason);

		expect((await loadRunContext(db, plain.runId))?.run.verify).toBe(false);
		expect((await loadRunContext(db, asked.runId))?.run.verify).toBe(true);
	});

	it("is saved on a running run, shown with the chat's runs, and ignored from an old attempt", async () => {
		const { userId, chatId, runId } = await running();

		await setVerification(db, runId, result, 99);
		expect((await listRuns(db, userId, chatId))[0]?.verification).toBeNull();

		await setVerification(db, runId, result, 1);
		expect((await listRuns(db, userId, chatId))[0]?.verification).toEqual(result);
	});

	it("is kept when the run finishes, and not changed afterwards", async () => {
		const { userId, chatId, runId } = await running();
		await setVerification(db, runId, result);
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });
		await setVerification(db, runId, { ...result, exitCode: 0 });
		expect((await listRuns(db, userId, chatId))[0]?.verification?.exitCode).toBe(1);
	});
});

describe("pull request on a chat", () => {
	it("is saved once, shown with the chat, and loaded for the worker", async () => {
		const { userId, chatId, runId } = await running();
		await setPullRequest(db, chatId, { number: 7, url: "https://github.com/o/r/pull/7" });

		expect(await getChatForUser(db, userId, chatId)).toMatchObject({
			pullRequestNumber: 7,
			pullRequestUrl: "https://github.com/o/r/pull/7",
			pullRequestError: null,
		});
		expect((await loadRunContext(db, runId))?.chat).toMatchObject({ pullRequestNumber: 7 });
	});

	it("keeps the reason a PR could not be opened, and clears it once one is", async () => {
		const { userId, chatId } = await running();
		await setPullRequestError(db, chatId, "Resource not accessible by integration");
		expect((await getChatForUser(db, userId, chatId))?.pullRequestError).toContain("not accessible");

		await setPullRequest(db, chatId, { number: 1, url: "https://github.com/o/r/pull/1" });
		expect((await getChatForUser(db, userId, chatId))?.pullRequestError).toBeNull();
	});
});
