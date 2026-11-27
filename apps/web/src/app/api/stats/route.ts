import { getDailyStats, getStatsTotals } from "@nullfuse/db";
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { db } from "@/server/db";

// Public numbers for the landing page. They come from `daily_stats`, which a worker task
// refreshes every hour, so caching for an hour loses nothing.
async function loadStats() {
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
			cachedInput:
				totals.inputTokens > 0 ? totals.cachedInputTokens / totals.inputTokens : null,
		},
		daily,
		generatedAt: new Date().toISOString(),
	};
}

export async function GET() {
	// Read at request time: the build has no database to prerender from.
	await connection();
	return Response.json(await loadStats(), {
		headers: {
			"Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
