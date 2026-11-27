import { idempotencyKeys, logger, schedules, tasks } from "@trigger.dev/sdk";
import { getDeps } from "../deps";
import { loadEnv } from "../env";
import { reportToConnectors } from "../report";
import { type Enqueue, sweepRuns } from "../sweep";

const BUCKET_MS = 5 * 60_000;

// The web app's trigger used a once-ever key for the run, so a new trigger needs its own key.
// The key repeats within a time bucket, so two overlapping sweeps send one trigger.
const enqueue: Enqueue = async ({ runId, chatId, reason }) => {
	const bucket = Math.floor(Date.now() / BUCKET_MS);
	await tasks.trigger(
		"run-agent",
		{ runId },
		{
			idempotencyKey: await idempotencyKeys.create(`${runId}:${reason}:${bucket}`, { scope: "global" }),
			idempotencyKeyTTL: "10m",
			concurrencyKey: chatId,
		},
	);
};

export const sweepRunsTask = schedules.task({
	id: "sweep-runs",
	cron: { pattern: "* * * * *", window: "2m" },
	run: async () => {
		const env = loadEnv();
		const { db } = await getDeps();
		const result = await sweepRuns(db, enqueue, {
			staleMs: env.RUN_STALE_SECONDS * 1000,
			maxAttempts: env.RUN_MAX_ATTEMPTS,
			stalledQueuedMs: 2 * 60_000,
		});
		if (result.swept.length > 0 || result.retriggered > 0) logger.warn("Run sweep", result);
		// Covers replies that failed, and runs that ended without their task, such as a cancel.
		await reportToConnectors();
		return { swept: result.swept.length, retriggered: result.retriggered };
	},
});
