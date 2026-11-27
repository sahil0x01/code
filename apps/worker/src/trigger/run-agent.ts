import { executeRun } from "@nullfuse/runner";
import { logger, task } from "@trigger.dev/sdk";
import { getDeps } from "../deps";

export const runAgentTask = task({
	id: "run-agent",
	// One run at a time per chat (the web app triggers with concurrencyKey = chat id).
	concurrency: { perKey: 1 },
	maxDuration: 30 * 60,
	// A retry after the run was claimed would find it already taken. Waiting for
	// an earlier run is the one case worth retrying, and it throws below.
	retry: { maxAttempts: 5, minTimeoutInMs: 5_000, factor: 2, maxTimeoutInMs: 60_000 },
	run: async (payload: { runId: string }, { signal }) => {
		const result = await executeRun(await getDeps(), payload.runId, { signal });

		if (!result.claimed) {
			logger.warn("Run was not started", { runId: payload.runId, reason: result.reason });
			// These clear up on their own: retry, and the sweeper picks the run up if the retries run out.
			if (["busy", "not_next", "user_busy", "no_capacity"].includes(result.reason)) {
				throw new Error(`The run has to wait (${result.reason})`);
			}
			return { claimed: false, reason: result.reason };
		}

		logger.info("Run finished", { runId: payload.runId, status: result.status, stopReason: result.stopReason });
		return { claimed: true, status: result.status, stopReason: result.stopReason };
	},
});
