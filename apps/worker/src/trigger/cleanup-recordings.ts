import { deleteQueuedRecordings, expireRecordings } from "@nullfuse/db";
import { destroyStaleAgent37 } from "@nullfuse/sandbox";
import { createR2Store, r2ConfigFrom } from "@nullfuse/storage";
import { logger, schedules } from "@trigger.dev/sdk";
import { getDeps } from "../deps";
import { loadEnv } from "../env";

// Longer than a run's task may last.
const STALE_SANDBOX_MS = 45 * 60_000;

/** Agent37 has no lifetime limit, so a sandbox whose worker died is deleted here. */
async function removeStaleSandboxes() {
	const env = loadEnv();
	if (env.SANDBOX_DRIVER !== "agent37" || !env.AGENT37_API_KEY) return;
	try {
		const result = await destroyStaleAgent37({ apiKey: env.AGENT37_API_KEY, olderThanMs: STALE_SANDBOX_MS });
		if (result.removed > 0 || result.failed.length > 0) logger.warn("Removed leftover sandboxes", result);
	} catch (error) {
		logger.error("Could not check for leftover sandboxes", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export const cleanupRecordingsTask = schedules.task({
	id: "cleanup-recordings",
	cron: { pattern: "*/10 * * * *", window: "5m" },
	run: async () => {
		const { db } = await getDeps();
		await removeStaleSandboxes();
		const expired = await expireRecordings(db);

		const config = r2ConfigFrom(loadEnv());
		// Without storage settings the files stay queued until there are some.
		if (!config) return { expired, deleted: 0, failed: 0 };

		const result = await deleteQueuedRecordings(db, createR2Store(config).remove);
		if (result.failed.length > 0) {
			logger.error("Some recordings could not be deleted", { failed: result.failed.slice(0, 5) });
		}
		return { expired, deleted: result.deleted, failed: result.failed.length };
	},
});
