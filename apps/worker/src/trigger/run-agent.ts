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
			// user_busy: the user's other runs are using their share; retry, and the sweeper picks it up if this runs out.
			if (result.reason === "busy" || result.reason === "not_next" || result.reason === "user_busy") {
				throw new Error(`Waiting for an earlier run in the same chat (${result.reason})`);
			}
			return { claimed: false, reason: result.reason };
		}

		logger.info("Run finished", { runId: payload.runId, status: result.status, stopReason: result.stopReason });
		return { claimed: true, status: result.status, stopReason: result.stopReason };
	},
});
