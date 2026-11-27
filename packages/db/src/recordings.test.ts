import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	chat,
	claimRun,
	createChat,
	deleteChat,
	deleteQueuedRecordings,
	expireRecordings,
	finishRun,
	queueRecordingDeletion,
	recordingDeletion,
	run,
	setRecording,
	user,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

const video = (key: string) => ({
	status: "recorded" as const,
	key,
	passed: true,
	error: null,
	durationMs: 1,
	bytes: 1,
});

async function recorded(finishedDaysAgo = 0) {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const created = await createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "m",
		content: "hi",
	});
	if (!created.ok) throw new Error(created.reason);
	await claimRun(db, created.runId);
	const key = `recordings/test/${created.runId}.webm`;
	await setRecording(db, created.runId, video(key));
	await finishRun(db, created.runId, { status: "succeeded", stopReason: "completed" });
	await db
		.update(run)
		.set({ finishedAt: new Date(Date.now() - finishedDaysAgo * 86_400_000) })
		.where(eq(run.id, created.runId));
	return { ...created, userId, key };
}

const queued = async (...keys: string[]) =>
	(
		await db.select().from(recordingDeletion).where(inArray(recordingDeletion.key, keys))
	).map((row) => row.key);

describe("recording deletion", () => {
	it("queues the video when its chat is deleted", async () => {
		const made = await recorded();
		expect(await queued(made.key)).toEqual([]);
		await deleteChat(db, made.userId, made.chatId);
		expect(await queued(made.key)).toEqual([made.key]);
	});

	it("queues videos removed by a cascade, such as deleting the account", async () => {
		const account = await recorded();
		const project = await recorded();
		await db.delete(user).where(eq(user.id, account.userId));
		await db.delete(chat).where(eq(chat.id, project.chatId));
		expect((await queued(account.key, project.key)).sort()).toEqual([account.key, project.key].sort());
	});

	it("queues a proof's screenshots along with its video", async () => {
		const made = await recorded();
		const shots = [`${made.key}-1.png`, `${made.key}-2.png`];
		await db
			.update(run)
			.set({ recording: { ...video(`${made.key}.new`), screenshots: shots.map((key) => ({ key, label: "" })) } })
			.where(eq(run.id, made.runId));
		await deleteChat(db, made.userId, made.chatId);
		expect((await queued(`${made.key}.new`, ...shots)).sort()).toEqual([`${made.key}.new`, ...shots].sort());
	});

	it("queues a replaced video, but not one that is unchanged", async () => {
		const made = await recorded();
		await db.update(run).set({ recording: video(made.key) }).where(eq(run.id, made.runId));
		expect(await queued(made.key)).toEqual([]);
		await db.update(run).set({ recording: video("recordings/test/new.webm") }).where(eq(run.id, made.runId));
		expect(await queued(made.key)).toEqual([made.key]);
	});

	it("refuses to save a video on a run that is no longer running", async () => {
		const made = await recorded();
		expect(await setRecording(db, made.runId, video("recordings/test/late.webm"))).toBe(false);
	});

	it("expires only videos older than the retention period", async () => {
		const old = await recorded(31);
		const recent = await recorded(29);

		expect(await expireRecordings(db)).toBeGreaterThanOrEqual(1);

		const [expired] = await db.select().from(run).where(eq(run.id, old.runId));
		expect(expired?.recording).toMatchObject({ status: "skipped", message: expect.stringContaining("30 days") });
		const [kept] = await db.select().from(run).where(eq(run.id, recent.runId));
		expect(kept?.recording?.status).toBe("recorded");
		expect(await queued(old.key, recent.key)).toEqual([old.key]);
	});

	it("removes queued files and keeps the ones that fail for later", async () => {
		const good = `recordings/test/good-${Date.now()}.webm`;
		const bad = `recordings/test/bad-${Date.now()}.webm`;
		await queueRecordingDeletion(db, good);
		await queueRecordingDeletion(db, good);
		await queueRecordingDeletion(db, bad);

		const removed: string[] = [];
		const result = await deleteQueuedRecordings(
			db,
			async (key) => {
				if (key === bad) throw new Error("storage is down");
				removed.push(key);
			},
			10_000,
		);

		expect(removed.filter((key) => key === good)).toHaveLength(1);
		expect(result.failed).toContainEqual({ key: bad, error: "storage is down" });
		expect(await queued(good, bad)).toEqual([bad]);
		const [row] = await db.select().from(recordingDeletion).where(eq(recordingDeletion.key, bad));
		expect(row?.attempts).toBe(1);
		await deleteQueuedRecordings(db, async () => {}, 10_000);
		expect(await queued(bad)).toEqual([]);
	});
});
