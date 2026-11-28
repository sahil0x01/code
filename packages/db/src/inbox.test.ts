import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	addMessage,
	cancelRun,
	claimRun,
	createChat,
	finishRun,
	getChatForUser,
	getInbox,
	listChats,
	markChatMerged,
	markChatSeen,
	markPullMerged,
	project,
	setPullRequest,
	run,
	setChatDone,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function start() {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const created = await createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "deepseek-v4-pro",
		content: "Fix the test",
	});
	if (!created.ok) throw new Error(created.reason);
	return { userId, ...created };
}

async function finish(runId: string, status: "succeeded" | "failed" | "cancelled" = "succeeded") {
	await claimRun(db, runId);
	await finishRun(db, runId, { status, stopReason: status === "succeeded" ? "completed" : "error" });
}

const view = async (userId: string, chatId: string) => {
	const found = await getChatForUser(db, userId, chatId);
	return { state: found?.state, unread: found?.unread };
};

const finishedAt = async (runId: string) => {
	const [row] = await db.select({ at: run.finishedAt }).from(run).where(eq(run.id, runId));
	if (!row?.at) throw new Error("not finished");
	return row.at;
};

describe("chat review state", () => {
	it("goes from running to unread and needing review, then read, then done", async () => {
		const { userId, chatId, runId } = await start();
		expect(await view(userId, chatId)).toEqual({ state: "running", unread: false });

		await finish(runId);
		expect(await view(userId, chatId)).toEqual({ state: "needs_review", unread: true });

		await markChatSeen(db, userId, chatId, await finishedAt(runId));
		expect(await view(userId, chatId)).toEqual({ state: "needs_review", unread: false });

		expect(await setChatDone(db, userId, chatId, true)).toBe(true);
		expect(await view(userId, chatId)).toEqual({ state: "done", unread: false });

		await setChatDone(db, userId, chatId, false);
		expect((await view(userId, chatId)).state).toBe("needs_review");
	});

	it("needs review again after a follow-up finishes", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId);
		await setChatDone(db, userId, chatId, true);

		const next = await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content: "More" });
		if (!next.ok) throw new Error(next.reason);
		expect((await view(userId, chatId)).state).toBe("running");

		await finish(next.runId, "failed");
		expect(await view(userId, chatId)).toEqual({ state: "needs_review", unread: true });
	});

	it("keeps a newer result unread when an older page marks the chat seen", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId);
		const first = await finishedAt(runId);
		await markChatSeen(db, userId, chatId, first);

		const next = await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content: "More" });
		if (!next.ok) throw new Error(next.reason);
		await new Promise((resolve) => setTimeout(resolve, 5));
		await finish(next.runId);
		await markChatSeen(db, userId, chatId, first);

		expect((await view(userId, chatId)).unread).toBe(true);
	});

	it("has nothing to review when a run is cancelled before it starts", async () => {
		const { userId, chatId, runId } = await start();
		await cancelRun(db, userId, runId);
		expect(await view(userId, chatId)).toEqual({ state: "done", unread: false });
	});

	it("asks for review of a stopped run, without calling it unread", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId, "cancelled");
		expect(await view(userId, chatId)).toEqual({ state: "needs_review", unread: false });
	});

	it("does not let another user mark or finish a chat", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId);
		const stranger = await fixtures.user();

		await markChatSeen(db, stranger, chatId, new Date());
		expect(await setChatDone(db, stranger, chatId, true)).toBe(false);
		expect(await view(userId, chatId)).toEqual({ state: "needs_review", unread: true });
	});

	it("counts the inbox for one user only", async () => {
		const { userId, chatId, runId } = await start();
		await start();
		expect(await getInbox(db, userId)).toEqual({ queued: 1, running: 0, needsReview: 0, unread: 0, finished: [] });

		await finish(runId);
		expect(await getInbox(db, userId)).toEqual({
			queued: 0,
			running: 0,
			needsReview: 1,
			unread: 1,
			finished: [{ runId, chatId, title: "Fix the test", status: "succeeded" }],
		});
		expect(await listChats(db, userId)).toMatchObject([{ id: chatId, state: "needs_review", unread: true }]);
	});
});

describe("merged pull requests", () => {
	it("mark the chat done and close it to new messages", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId);
		await markChatMerged(db, await fixtures.user(), chatId);
		expect(await getChatForUser(db, userId, chatId)).toMatchObject({ state: "needs_review", merged: false });

		await markChatMerged(db, userId, chatId);
		expect(await getChatForUser(db, userId, chatId)).toMatchObject({ state: "done", unread: false, merged: true });
		expect(await addMessage(db, { userId, chatId, model: "deepseek-v4-pro", content: "More" })).toEqual({
			ok: false,
			reason: "merged",
		});
	});

	it("are matched to the chat by installation, repository and number", async () => {
		const { userId, chatId, runId } = await start();
		await finish(runId);
		await setPullRequest(db, chatId, { number: 5, url: "https://github.com/acme/app/pull/5" });
		const [row] = await db.select().from(project).where(eq(project.userId, userId));
		if (!row?.installationId) throw new Error("no project");

		await markPullMerged(db, row.installationId, row.githubRepoId + 1, 5);
		await markPullMerged(db, row.installationId, row.githubRepoId, 6);
		expect((await view(userId, chatId)).state).toBe("needs_review");

		await markPullMerged(db, row.installationId, row.githubRepoId, 5);
		expect((await view(userId, chatId)).state).toBe("done");
	});
});
