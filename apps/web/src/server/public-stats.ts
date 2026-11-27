import "server-only";
import { getDailyStats, getStatsTotals } from "@nullfuse/db";
import { cacheLife } from "next/cache";
import { db } from "@/server/db";

// Public numbers, for /stats and /api/stats. They come from `daily_stats`, which a worker
// task refreshes every hour, so caching for an hour loses nothing. Callers must be
// rendering at request time (after `connection()`): the build has no database.
export async function loadPublicStats() {
	"use cache";
	cacheLife("hours");

	const [totals, daily] = await Promise.all([getStatsTotals(db), getDailyStats(db, 90)]);
	const finished = totals.runsSucceeded + totals.runsFailed;
	return {
		totals: {
			...totals,
			agentHours: Math.round(totals.agentSeconds / 3600),
		},
		rates: {
			runSuccess: finished > 0 ? totals.runsSucceeded / finished : null,
			testsPassed: totals.runsVerified > 0 ? totals.runsVerifiedPassed / totals.runsVerified : null,
			pullRequestsMerged:
				totals.pullRequestsOpened > 0 ? totals.pullRequestsMerged / totals.pullRequestsOpened : null,
			cachedInput: totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : null,
		},
		daily,
		generatedAt: new Date().toISOString(),
	};
}

export type PublicStats = Awaited<ReturnType<typeof loadPublicStats>>;
