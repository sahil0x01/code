import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	chat,
	claimRun,
	createChat,
	deleteChat,
	endPreview,
	finishRun,
	keepPreview,
	preview,
	project,
	requestPreview,
	setPreviewReady,
	setWorkingBranchIfUnset,
	stopPreview,
	viewPreview,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function setup({ branch = true, app = true } = {}) {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	if (app) {
		await db.update(project).set({ startCommand: "npm start", appPort: 3000 }).where(eq(project.id, projectId));
	}
	const created = await createChat(db, { userId, projectId, baseBranch: "main", model: "deepseek-v4-pro", content: "Go" });
	if (!created.ok) throw new Error(created.reason);
	if (branch) await setWorkingBranchIfUnset(db, created.chatId, "nullfuse/chat-test");
	return { userId, ...created };
}

async function started(userId: string, chatId: string) {
	const result = await requestPreview(db, userId, chatId);
	if (!result.ok || !result.start) throw new Error("expected a new preview");
	return result.generation;
}

const ready = { url: "https://3000-token.example.test", expiresAt: new Date(Date.now() + 60_000) };

describe("requestPreview", () => {
	it("starts one and then reuses it while its worker is alive", async () => {
		const { userId, chatId } = await setup();
		await started(userId, chatId);

		expect(await requestPreview(db, userId, chatId)).toEqual({ ok: true, start: false });
	});

	it("replaces one whose worker went quiet, and fences the old worker off", async () => {
		const { userId, chatId } = await setup();
		const old = await started(userId, chatId);
		await db.update(preview).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(preview.chatId, chatId));

		const next = await started(userId, chatId);

		expect(next).not.toBe(old);
		expect(await keepPreview(db, chatId, old)).toBeNull();
		expect(await setPreviewReady(db, chatId, old, ready)).toBe(false);
		expect(await setPreviewReady(db, chatId, next, ready)).toBe(true);
	});

	it("starts again when a run finished after the preview began", async () => {
		const { userId, chatId, runId } = await setup();
		await started(userId, chatId);
		await claimRun(db, runId);
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });

		expect(await requestPreview(db, userId, chatId)).toMatchObject({ start: true });
	});

	it("says why it cannot start, and refuses other users", async () => {
		const noApp = await setup({ app: false });
		const noBranch = await setup({ branch: false });
		const other = await fixtures.user();

		expect(await requestPreview(db, noApp.userId, noApp.chatId)).toEqual({ ok: false, reason: "not_set_up" });
		expect(await requestPreview(db, noBranch.userId, noBranch.chatId)).toEqual({ ok: false, reason: "no_branch" });
		expect(await requestPreview(db, other, noApp.chatId)).toEqual({ ok: false, reason: "not_found" });
	});
});

describe("a live preview", () => {
	it("is visible and stoppable only by its owner", async () => {
		const { userId, chatId } = await setup();
		const generation = await started(userId, chatId);
		await setPreviewReady(db, chatId, generation, ready);
		const other = await fixtures.user();

		expect(await viewPreview(db, other, chatId)).toBeNull();
		await stopPreview(db, other, chatId);
		expect(await viewPreview(db, userId, chatId)).toMatchObject({ status: "ready", url: ready.url });

		await stopPreview(db, userId, chatId);
		expect(await viewPreview(db, userId, chatId)).toMatchObject({ status: "stopped", url: null });
		expect(await keepPreview(db, chatId, generation)).toBeNull();
	});

	it("drops the address when it fails, and goes with its chat", async () => {
		const { userId, chatId, runId } = await setup();
		const generation = await started(userId, chatId);
		await endPreview(db, chatId, generation, { status: "failed", error: "boom" });
		expect(await viewPreview(db, userId, chatId)).toMatchObject({ status: "failed", error: "boom", url: null });

		await claimRun(db, runId);
		await finishRun(db, runId, { status: "succeeded", stopReason: "completed" });
		await deleteChat(db, userId, chatId);
		expect(await db.select().from(preview).where(eq(preview.chatId, chatId))).toEqual([]);
		expect(await db.select().from(chat).where(eq(chat.id, chatId))).toEqual([]);
	});
});
