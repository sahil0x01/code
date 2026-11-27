import { recoverRun } from "@nullfuse/db";
import { executeRun } from "@nullfuse/runner";
import { logger, task, wait } from "@trigger.dev/sdk";
import { getDeps } from "../deps";
import { loadEnv } from "../env";
import { RETRY_SECONDS, runWhenThereIsRoom, waitForDeadAttempt } from "../wait";

export const runAgentTask = task({
	id: "run-agent",
	// 0.25 vCPU and 0.25 GB: the task mostly waits on the model and the sandbox.
	machine: "micro",
	// One run at a time per chat (the web app triggers with concurrencyKey = chat id).
	concurrency: { perKey: 1 },
	maxDuration: 30 * 60,
	// For failures before the run is claimed, such as the database being away, and for
	// running out of memory, which is tried again on a larger machine.
	retry: {
		maxAttempts: 5,
		minTimeoutInMs: 5_000,
		factor: 2,
		maxTimeoutInMs: 60_000,
		outOfMemory: { machine: "small-1x" },
	},
	run: async (payload: { runId: string }, { ctx, signal }) => {
		const deps = await getDeps();
		if (ctx.attempt.number > 1) {
			const env = loadEnv();
			await waitForDeadAttempt(
				() =>
					recoverRun(deps.db, payload.runId, {
						staleMs: env.RUN_STALE_SECONDS * 1000,
						maxAttempts: env.RUN_MAX_ATTEMPTS,
					}),
				() => wait.for({ seconds: RETRY_SECONDS }),
				env.RUN_STALE_SECONDS,
			);
		}
		// Waiting happens here and not through retries, which run out and back off.
		const result = await runWhenThereIsRoom(
			() => executeRun(deps, payload.runId, { signal }),
			() => wait.for({ seconds: RETRY_SECONDS }),
		);

		if (!result.claimed) {
			logger.warn("Run was not started", { runId: payload.runId, reason: result.reason });
			return { claimed: false, reason: result.reason };
		}

		logger.info("Run finished", { runId: payload.runId, status: result.status, stopReason: result.stopReason });
		return { claimed: true, status: result.status, stopReason: result.stopReason };
	},
});
