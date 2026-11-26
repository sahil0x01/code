import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	addMessage,
	cancelRun,
	chat,
	createChat,
	deleteChat,
	exportAccountData,
	getChatForUser,
	listChats,
	listMessages,
	listProjectSummaries,
	listRuns,
	MAX_UNFINISHED_RUNS_PER_USER,
	message,
	project,
	run,
	titleFromMessage,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function owner(options: { connected?: boolean } = {}) {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId, options);
	return { userId, projectId };
}

function startRaw(userId: string, projectId: string, content = "Fix the test") {
	return createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "deepseek-v4-pro",
		content,
	});
}

async function start(userId: string, projectId: string, content?: string) {
	const result = await startRaw(userId, projectId, content);
	if (!result.ok) throw new Error(`createChat failed: ${result.reason}`);
	return result;
}

function reply(userId: string, chatId: string, content = "And also this") {
	return addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content });
}

// Drizzle wraps driver errors, so walk the cause chain to the Postgres code.
async function postgresCode(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		let current: unknown = error;
		while (typeof current === "object" && current !== null) {
			if ("code" in current && typeof current.code === "string") {
				return current.code;
			}
			current = "cause" in current ? current.cause : null;
		}
	}
	return null;
}

function setStatus(runId: string, status: "queued" | "running") {
	return db.update(run).set({ status }).where(eq(run.id, runId));
}

describe("titleFromMessage", () => {
	it("uses the first line, with whitespace collapsed", () => {
		expect(titleFromMessage("  Fix   the\ttest \nthen more")).toBe(
			"Fix the test",
		);
	});

	it("cuts long titles at 80 characters", () => {
		const title = titleFromMessage("a".repeat(200));
		expect(title).toHaveLength(80);
		expect(title.endsWith("...")).toBe(true);
	});

	it("falls back when there is no text", () => {
		expect(titleFromMessage("   \n  ")).toBe("New chat");
	});
});

describe("createChat", () => {
	it("creates the chat, its first message and a queued run together", async () => {
		const { userId, projectId } = await owner();
		const result = await start(userId, projectId, "Fix the date test\nmore");

		const found = await getChatForUser(db, userId, result.chatId);
		expect(found?.title).toBe("Fix the date test");
		expect(found?.connected).toBe(true);

		const messages = await listMessages(db, userId, result.chatId);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatchObject({
			role: "user",
			content: "Fix the date test\nmore",
		});

		const runs = await listRuns(db, userId, result.chatId);
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({
			id: result.runId,
			messageId: result.messageId,
			status: "queued",
			model: "deepseek-v4-pro",
			startedAt: null,
		});
	});

	it("does not accept someone else's project", async () => {
		const mine = await owner();
		const other = await owner();

		const result = await startRaw(other.userId, mine.projectId);
		expect(result).toEqual({ ok: false, reason: "not_found" });
		expect(await listChats(db, other.userId)).toHaveLength(0);
	});

	it("rejects a disconnected project", async () => {
		const { userId, projectId } = await owner({ connected: false });
		expect(await startRaw(userId, projectId)).toEqual({
			ok: false,
			reason: "disconnected",
		});
	});

	it("stops at the unfinished-run cap and writes nothing extra", async () => {
		const { userId, projectId } = await owner();
		for (let i = 0; i < MAX_UNFINISHED_RUNS_PER_USER; i++) {
			await start(userId, projectId, `Task ${i}`);
		}

		expect(await startRaw(userId, projectId)).toEqual({
			ok: false,
			reason: "queue_full",
		});
		expect(await listChats(db, userId)).toHaveLength(
			MAX_UNFINISHED_RUNS_PER_USER,
		);
	});

	it("does not count another user's runs against the cap", async () => {
		const busy = await owner();
		for (let i = 0; i < MAX_UNFINISHED_RUNS_PER_USER; i++) {
			await start(busy.userId, busy.projectId);
		}

		const other = await owner();
		expect((await startRaw(other.userId, other.projectId)).ok).toBe(true);
	});
});

describe("addMessage", () => {
	it("queues a follow-up behind the first run, in order", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId);

		const second = await reply(userId, first.chatId, "Second");
		const third = await reply(userId, first.chatId, "Third");
		expect(second.ok && third.ok).toBe(true);

		const messages = await listMessages(db, userId, first.chatId);
		expect(messages.map((m) => m.content)).toEqual([
			"Fix the test",
			"Second",
			"Third",
		]);

		const runs = await listRuns(db, userId, first.chatId);
		expect(runs.map((r) => r.status)).toEqual(["queued", "queued", "queued"]);
	});

	it("moves the chat to the top of the list", async () => {
		const { userId, projectId } = await owner();
		const older = await start(userId, projectId, "Older");
		await new Promise((resolve) => setTimeout(resolve, 20));
		await start(userId, projectId, "Newer");

		expect((await listChats(db, userId))[0]?.title).toBe("Newer");

		await new Promise((resolve) => setTimeout(resolve, 20));
		await reply(userId, older.chatId);
		expect((await listChats(db, userId))[0]?.title).toBe("Older");
	});

	it("does not accept messages for someone else's chat", async () => {
		const mine = await owner();
		const other = await owner();
		const created = await start(mine.userId, mine.projectId);

		expect(await reply(other.userId, created.chatId)).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(await listMessages(db, mine.userId, created.chatId)).toHaveLength(1);
		expect(await listRuns(db, mine.userId, created.chatId)).toHaveLength(1);
	});

	it("rejects a message once the project is disconnected", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		await db
			.update(project)
			.set({ installationId: null })
			.where(eq(project.id, projectId));

		expect(await reply(userId, created.chatId)).toEqual({
			ok: false,
			reason: "disconnected",
		});
	});

	it("stops at the unfinished-run cap", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		for (let i = 1; i < MAX_UNFINISHED_RUNS_PER_USER; i++) {
			expect((await reply(userId, created.chatId)).ok).toBe(true);
		}

		expect(await reply(userId, created.chatId)).toEqual({
			ok: false,
			reason: "queue_full",
		});
	});
});

describe("reads are scoped to the owner", () => {
	it("returns nothing for another user", async () => {
		const mine = await owner();
		const other = await owner();
		const created = await start(mine.userId, mine.projectId);

		expect(await getChatForUser(db, other.userId, created.chatId)).toBeNull();
		expect(await listMessages(db, other.userId, created.chatId)).toEqual([]);
		expect(await listRuns(db, other.userId, created.chatId)).toEqual([]);
		expect(await listChats(db, other.userId)).toEqual([]);
	});

	it("shows the status of the newest run in the list", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		await setStatus(created.runId, "running");

		const [row] = await listChats(db, userId);
		expect(row?.lastRunStatus).toBe("running");
	});
});

describe("rules the database enforces", () => {
	it("allows only one running run per chat", async () => {
		const { userId, projectId } = await owner();
		const first = await start(userId, projectId);
		const second = await reply(userId, first.chatId);
		if (!second.ok) throw new Error("reply failed");

		await setStatus(first.runId, "running");
		expect(await postgresCode(setStatus(second.runId, "running"))).toBe(
			"23505",
		);
	});

	it("allows a running run in each of two different chats", async () => {
		const { userId, projectId } = await owner();
		const a = await start(userId, projectId);
		const b = await start(userId, projectId);

		await setStatus(a.runId, "running");
		expect(await postgresCode(setStatus(b.runId, "running"))).toBeNull();
	});

	it("rejects a status that is not in the list", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		const bad = db
			.update(run)
			.set({ status: "banana" as unknown as "queued" })
			.where(eq(run.id, created.runId));
		expect(await postgresCode(bad)).toBe("23514");
	});

	it("rejects a message role that is not in the list", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		const bad = db.insert(message).values({
			chatId: created.chatId,
			role: "system" as unknown as "user",
			content: "x",
		});
		expect(await postgresCode(bad)).toBe("23514");
	});
});

describe("cancelRun", () => {
	it("cancels a queued run and frees its place in the cap", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		for (let i = 1; i < MAX_UNFINISHED_RUNS_PER_USER; i++) {
			await reply(userId, created.chatId);
		}
		expect((await reply(userId, created.chatId)).ok).toBe(false);

		expect(await cancelRun(db, userId, created.runId)).toEqual({
			chatId: created.chatId,
		});

		const [first] = await listRuns(db, userId, created.chatId);
		expect(first?.status).toBe("cancelled");
		expect(first?.finishedAt).toBeInstanceOf(Date);
		expect((await reply(userId, created.chatId)).ok).toBe(true);
	});

	it("does nothing the second time", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		expect(await cancelRun(db, userId, created.runId)).not.toBeNull();
		expect(await cancelRun(db, userId, created.runId)).toBeNull();
	});

	it("cannot cancel a run that has started", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		await setStatus(created.runId, "running");

		expect(await cancelRun(db, userId, created.runId)).toBeNull();
		const [row] = await listRuns(db, userId, created.chatId);
		expect(row?.status).toBe("running");
	});

	it("cannot cancel someone else's run", async () => {
		const mine = await owner();
		const other = await owner();
		const created = await start(mine.userId, mine.projectId);

		expect(await cancelRun(db, other.userId, created.runId)).toBeNull();
		const [row] = await listRuns(db, mine.userId, created.chatId);
		expect(row?.status).toBe("queued");
	});
});

describe("deleteChat", () => {
	async function counts(chatId: string) {
		const messages = await db
			.select({ id: message.id })
			.from(message)
			.where(eq(message.chatId, chatId));
		const runs = await db
			.select({ id: run.id })
			.from(run)
			.where(eq(run.chatId, chatId));
		return { messages: messages.length, runs: runs.length };
	}

	it("removes the chat with its messages and runs", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		await reply(userId, created.chatId);
		expect(await counts(created.chatId)).toEqual({ messages: 2, runs: 2 });

		expect(await deleteChat(db, userId, created.chatId)).toEqual({ ok: true });
		expect(await getChatForUser(db, userId, created.chatId)).toBeNull();
		expect(await counts(created.chatId)).toEqual({ messages: 0, runs: 0 });
	});

	it("refuses while a run is working", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);
		await setStatus(created.runId, "running");

		expect(await deleteChat(db, userId, created.chatId)).toEqual({
			ok: false,
			reason: "running",
		});
		expect(await getChatForUser(db, userId, created.chatId)).not.toBeNull();
	});

	it("does not delete someone else's chat", async () => {
		const mine = await owner();
		const other = await owner();
		const created = await start(mine.userId, mine.projectId);

		expect(await deleteChat(db, other.userId, created.chatId)).toEqual({
			ok: false,
			reason: "not_found",
		});
		expect(await getChatForUser(db, mine.userId, created.chatId)).not.toBeNull();
	});

	it("is removed with the project", async () => {
		const { userId, projectId } = await owner();
		const created = await start(userId, projectId);

		await db.delete(project).where(eq(project.id, projectId));
		expect(await counts(created.chatId)).toEqual({ messages: 0, runs: 0 });
		expect(await db.select().from(chat).where(eq(chat.id, created.chatId))).toEqual(
			[],
		);
	});
});

describe("listProjectSummaries", () => {
	it("counts chats and puts the most recently active project first", async () => {
		const userId = await fixtures.user();
		const quiet = await fixtures.project(userId);
		const busy = await fixtures.project(userId);
		const idle = await fixtures.project(userId);

		await start(userId, busy, "First");
		await start(userId, busy, "Second");
		await new Promise((resolve) => setTimeout(resolve, 20));
		await start(userId, quiet, "Third");

		const rows = await listProjectSummaries(db, userId);
		expect(rows.map((row) => row.id)).toEqual([quiet, busy, idle]);
		expect(rows.map((row) => row.chatCount)).toEqual([1, 2, 0]);
		expect(rows[0]?.lastActivityAt).toBeInstanceOf(Date);
		expect(rows[2]?.lastActivityAt).toBeNull();
	});

	it("only includes the user's own projects", async () => {
		const mine = await owner();
		const other = await owner();
		await start(other.userId, other.projectId);

		const rows = await listProjectSummaries(db, mine.userId);
		expect(rows.map((row) => row.id)).toEqual([mine.projectId]);
		expect(rows[0]?.chatCount).toBe(0);
	});
});

describe("account export", () => {
	it("includes the user's chats, messages and runs, and nobody else's", async () => {
		const mine = await owner();
		const other = await owner();
		const created = await start(mine.userId, mine.projectId, "My secret task");
		await start(other.userId, other.projectId, "Their task");

		const data = await exportAccountData(db, mine.userId);
		expect(data?.chats.map((c) => c.id)).toEqual([created.chatId]);
		expect(data?.messages.map((m) => m.content)).toEqual(["My secret task"]);
		expect(data?.runs.map((r) => r.id)).toEqual([created.runId]);
	});
});
