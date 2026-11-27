import { refreshRecentStats } from "@nullfuse/db";
import { schedules } from "@trigger.dev/sdk";
import { getDeps } from "../deps";

// Hourly, so public numbers are at most an hour old. Each run rewrites only the last few days.
export const refreshStatsTask = schedules.task({
	id: "refresh-stats",
	cron: { pattern: "7 * * * *", window: "30m" },
	run: async () => {
		const { db } = await getDeps();
		return refreshRecentStats(db);
	},
});
