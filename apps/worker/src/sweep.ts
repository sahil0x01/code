import { type Db, listStalledQueued, sweepStaleRuns } from "@nullfuse/db";

export type Enqueue = (input: { runId: string; chatId: string; reason: "resume" | "stalled" }) => Promise<void>;

export type SweepOptions = {
	staleMs: number;
	maxAttempts: number;
	/** A queued run nobody started for this long gets its trigger sent again. */
	stalledQueuedMs: number;
};

// Runs whose worker died go back to the queue (or fail after too many tries), and
// runs whose trigger was lost are triggered again.
export async function sweepRuns(db: Db, enqueue: Enqueue, options: SweepOptions) {
	const swept = await sweepStaleRuns(db, options);
	const resumed = swept.filter((run) => run.action === "requeued");
	for (const run of resumed) await enqueue({ runId: run.id, chatId: run.chatId, reason: "resume" });

	const stalled = await listStalledQueued(db, { olderThanMs: options.stalledQueuedMs });
	for (const run of stalled) await enqueue({ runId: run.id, chatId: run.chatId, reason: "stalled" });

	return { swept, resumed: resumed.length, retriggered: stalled.length };
}
