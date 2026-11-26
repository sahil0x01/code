import { claimRun, createChat } from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { type Enqueue, sweepRuns } from "./sweep";

const db = connect();
const fixtures = new Fixtures(db);
const options = { staleMs: 3_600_000, maxAttempts: 3, stalledQueuedMs: 3_600_000 };

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function queued() {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const created = await createChat(db, { userId, projectId, baseBranch: "main", model: "deepseek-v4-pro", content: "Go" });
	if (!created.ok) throw new Error(created.reason);
	return created;
}

const hoursAgo = (hours: number) => `now() - interval '${hours} hours'`;
const setTimes = (runId: string, column: "heartbeat_at" | "updated_at", hours: number) =>
	db.$client.query(`update run set ${column} = ${hoursAgo(hours)} where id = $1`, [runId]);

function collector() {
	const calls: Parameters<Enqueue>[0][] = [];
	return { calls, enqueue: (async (input) => void calls.push(input)) as Enqueue };
}

describe("sweepRuns", () => {
	it("puts a crashed run back in the queue and triggers it again", async () => {
		const { runId, chatId } = await queued();
		await claimRun(db, runId);
		await setTimes(runId, "heartbeat_at", 2);
		const { calls, enqueue } = collector();

		const result = await sweepRuns(db, enqueue, options);

		expect(result.resumed).toBeGreaterThanOrEqual(1);
		expect(calls).toContainEqual({ runId, chatId, reason: "resume" });
	});

	it("triggers a queued run again when nobody started it, but not a fresh one", async () => {
		const stalled = await queued();
		const fresh = await queued();
		await setTimes(stalled.runId, "updated_at", 2);
		const { calls, enqueue } = collector();

		await sweepRuns(db, enqueue, options);

		expect(calls).toContainEqual({ runId: stalled.runId, chatId: stalled.chatId, reason: "stalled" });
		expect(calls.find((call) => call.runId === fresh.runId)).toBeUndefined();
	});

	it("does nothing for a run that is alive", async () => {
		const { runId } = await queued();
		await claimRun(db, runId);
		const { calls, enqueue } = collector();

		await sweepRuns(db, enqueue, options);

		expect(calls.find((call) => call.runId === runId)).toBeUndefined();
	});
});
