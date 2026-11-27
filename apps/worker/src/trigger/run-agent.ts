import { executeRun } from "@nullfuse/runner";
import { logger, task, wait } from "@trigger.dev/sdk";
import { getDeps } from "../deps";
import { RETRY_SECONDS, runWhenThereIsRoom } from "../wait";

export const runAgentTask = task({
	id: "run-agent",
	// One run at a time per chat (the web app triggers with concurrencyKey = chat id).
	concurrency: { perKey: 1 },
	maxDuration: 30 * 60,
	// Only for failures before the run is claimed, such as the database being away.
	retry: { maxAttempts: 5, minTimeoutInMs: 5_000, factor: 2, maxTimeoutInMs: 60_000 },
	run: async (payload: { runId: string }, { signal }) => {
		const deps = await getDeps();
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
