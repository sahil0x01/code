import { deleteQueuedRecordings, expireRecordings } from "@nullfuse/db";
import { createR2Store, r2ConfigFrom } from "@nullfuse/storage";
import { logger, schedules } from "@trigger.dev/sdk";
import { getDeps } from "../deps";
import { loadEnv } from "../env";

export const cleanupRecordingsTask = schedules.task({
	id: "cleanup-recordings",
	cron: { pattern: "*/10 * * * *", window: "5m" },
	run: async () => {
		const { db } = await getDeps();
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
