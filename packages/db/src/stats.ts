import { asc, type Column, desc, gte, sql } from "drizzle-orm";
import type { Db } from "./index";
import { dailyStats } from "./schema";

/** Days newer than this are recomputed; older ones are kept as they are. */
export const STATS_OPEN_DAYS = 3;

const DAY_MS = 86_400_000;

/** The UTC day of a time, as `YYYY-MM-DD`. */
export function utcDay(time: Date) {
	return time.toISOString().slice(0, 10);
}

function addDays(day: string, days: number) {
	return utcDay(new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS));
}

/**
 * Counts what happened on each day from `from` to `to` (inclusive, UTC) and saves it,
 * replacing those days' rows. Each source table is read once for the whole range.
 */
export async function refreshDailyStats(db: Db, from: string, to: string) {
	const lo = `${from}T00:00:00Z`;
	const hi = `${addDays(to, 1)}T00:00:00Z`;
	const day = (column: string) => sql.raw(`(${column} at time zone 'UTC')::date`);
	const inRange = (column: string) =>
		sql`${sql.raw(column)} >= ${lo}::timestamptz and ${sql.raw(column)} < ${hi}::timestamptz`;

	await db.execute(sql`
		with days as (
			select d::date as day from generate_series(${from}::date, ${to}::date, interval '1 day') as d
		),
		joined as (
			select ${day("created_at")} as day, count(*)::int as n
			from "user" where ${inRange("created_at")} group by 1
		),
		projects as (
			select ${day("created_at")} as day, count(*)::int as n
			from project where ${inRange("created_at")} group by 1
		),
		chats as (
			select ${day("created_at")} as day, count(*)::int as n
			from chat where ${inRange("created_at")} group by 1
		),
		started as (
			select ${day("created_at")} as day, count(*)::int as runs, count(distinct user_id)::int as users
			from run where ${inRange("created_at")} group by 1
		),
		finished as (
			select ${day("finished_at")} as day,
				count(*) filter (where status = 'succeeded')::int as succeeded,
				count(*) filter (where status = 'failed')::int as failed,
				count(*) filter (where status = 'cancelled')::int as cancelled,
				coalesce(sum(extract(epoch from finished_at - started_at)) filter (where started_at is not null), 0)::bigint as seconds,
				coalesce(sum(jsonb_array_length(changed_files)) filter (where status = 'succeeded'), 0)::int as file_edits,
				sum(input_tokens)::bigint as input_tokens,
				sum(output_tokens)::bigint as output_tokens,
				sum(cached_input_tokens)::bigint as cached_input_tokens,
				sum(model_cost)::bigint as model_cost,
				sum(sandbox_cost)::bigint as sandbox_cost,
				count(*) filter (where verification is not null)::int as verified,
				count(*) filter (
					where (verification->>'exitCode')::int = 0
						and not coalesce((verification->>'timedOut')::boolean, false)
				)::int as passed
			from run where ${inRange("finished_at")} group by 1
		),
		steps as (
			select ${day("created_at")} as day, count(*)::int as n,
				coalesce(sum(jsonb_array_length(tool_calls)), 0)::int as tool_calls
			from run_step where ${inRange("created_at")} group by 1
		),
		opened as (
			select ${day("pull_request_opened_at")} as day, count(*)::int as n
			from chat where ${inRange("pull_request_opened_at")} group by 1
		),
		merged as (
			select ${day("pull_request_merged_at")} as day, count(*)::int as n,
				coalesce(sum(pull_request_additions), 0)::bigint as added,
				coalesce(sum(pull_request_deletions), 0)::bigint as removed
			from chat where ${inRange("pull_request_merged_at")} group by 1
		)
		insert into daily_stats (
			day, users_joined, active_users, projects_connected, chats_started,
			runs_started, runs_succeeded, runs_failed, runs_cancelled, agent_seconds,
			steps, tool_calls, file_edits, input_tokens, output_tokens, cached_input_tokens,
			model_cost, sandbox_cost, runs_verified, runs_verified_passed,
			pull_requests_opened, pull_requests_merged, lines_added, lines_removed, updated_at
		)
		select days.day,
			coalesce(joined.n, 0), coalesce(started.users, 0), coalesce(projects.n, 0), coalesce(chats.n, 0),
			coalesce(started.runs, 0), coalesce(finished.succeeded, 0), coalesce(finished.failed, 0),
			coalesce(finished.cancelled, 0), coalesce(finished.seconds, 0),
			coalesce(steps.n, 0), coalesce(steps.tool_calls, 0), coalesce(finished.file_edits, 0),
			coalesce(finished.input_tokens, 0), coalesce(finished.output_tokens, 0),
			coalesce(finished.cached_input_tokens, 0),
			coalesce(finished.model_cost, 0), coalesce(finished.sandbox_cost, 0),
			coalesce(finished.verified, 0), coalesce(finished.passed, 0),
			coalesce(opened.n, 0), coalesce(merged.n, 0), coalesce(merged.added, 0), coalesce(merged.removed, 0),
			now()
		from days
		left join joined using (day)
		left join projects using (day)
		left join chats using (day)
		left join started using (day)
		left join finished using (day)
		left join steps using (day)
		left join opened using (day)
		left join merged using (day)
		on conflict (day) do update set
			users_joined = excluded.users_joined,
			active_users = excluded.active_users,
			projects_connected = excluded.projects_connected,
			chats_started = excluded.chats_started,
			runs_started = excluded.runs_started,
			runs_succeeded = excluded.runs_succeeded,
			runs_failed = excluded.runs_failed,
			runs_cancelled = excluded.runs_cancelled,
			agent_seconds = excluded.agent_seconds,
			steps = excluded.steps,
			tool_calls = excluded.tool_calls,
			file_edits = excluded.file_edits,
			input_tokens = excluded.input_tokens,
			output_tokens = excluded.output_tokens,
			cached_input_tokens = excluded.cached_input_tokens,
			model_cost = excluded.model_cost,
			sandbox_cost = excluded.sandbox_cost,
			runs_verified = excluded.runs_verified,
			runs_verified_passed = excluded.runs_verified_passed,
			pull_requests_opened = excluded.pull_requests_opened,
			pull_requests_merged = excluded.pull_requests_merged,
			lines_added = excluded.lines_added,
			lines_removed = excluded.lines_removed,
			updated_at = excluded.updated_at
	`);
}

/**
 * Recomputes the last few days, up to today. The first time, it starts from the first user
 * so all history is counted once.
 */
export async function refreshRecentStats(db: Db, now = new Date()) {
	const today = utcDay(now);
	const [latest] = await db
		.select({ day: dailyStats.day })
		.from(dailyStats)
		.orderBy(desc(dailyStats.day))
		.limit(1);

	let from: string;
	if (latest) {
		from = addDays(latest.day < today ? latest.day : today, -(STATS_OPEN_DAYS - 1));
	} else {
		const result = await db.execute<{ first: string | null }>(
			sql`select to_char(min(created_at) at time zone 'UTC', 'YYYY-MM-DD') as first from "user"`,
		);
		from = result.rows[0]?.first ?? today;
	}
	if (from > today) from = today;
	await refreshDailyStats(db, from, today);
	return { from, to: today };
}

export type StatsTotals = {
	since: string | null;
	usersJoined: number;
	projectsConnected: number;
	chatsStarted: number;
	runsStarted: number;
	runsSucceeded: number;
	runsFailed: number;
	runsCancelled: number;
	agentSeconds: number;
	steps: number;
	toolCalls: number;
	fileEdits: number;
	inputTokens: number;
	outputTokens: number;
	cachedInputTokens: number;
	runsVerified: number;
	runsVerifiedPassed: number;
	pullRequestsOpened: number;
	pullRequestsMerged: number;
	linesAdded: number;
	linesRemoved: number;
};

const sum = (column: Column) => sql<number>`coalesce(sum(${column}), 0)::float8`;

/** Everything added up. Costs are left out: they are for us, not for a public page. */
export async function getStatsTotals(db: Db): Promise<StatsTotals> {
	const [row] = await db
		.select({
			since: sql<string | null>`min(${dailyStats.day})::text`,
			usersJoined: sum(dailyStats.usersJoined),
			projectsConnected: sum(dailyStats.projectsConnected),
			chatsStarted: sum(dailyStats.chatsStarted),
			runsStarted: sum(dailyStats.runsStarted),
			runsSucceeded: sum(dailyStats.runsSucceeded),
			runsFailed: sum(dailyStats.runsFailed),
			runsCancelled: sum(dailyStats.runsCancelled),
			agentSeconds: sum(dailyStats.agentSeconds),
			steps: sum(dailyStats.steps),
			toolCalls: sum(dailyStats.toolCalls),
			fileEdits: sum(dailyStats.fileEdits),
			inputTokens: sum(dailyStats.inputTokens),
			outputTokens: sum(dailyStats.outputTokens),
			cachedInputTokens: sum(dailyStats.cachedInputTokens),
			runsVerified: sum(dailyStats.runsVerified),
			runsVerifiedPassed: sum(dailyStats.runsVerifiedPassed),
			pullRequestsOpened: sum(dailyStats.pullRequestsOpened),
			pullRequestsMerged: sum(dailyStats.pullRequestsMerged),
			linesAdded: sum(dailyStats.linesAdded),
			linesRemoved: sum(dailyStats.linesRemoved),
		})
		.from(dailyStats);
	if (!row) throw new Error("totals query returned no row");
	return row;
}

/** The last `days` days, oldest first, for charts. */
export async function getDailyStats(db: Db, days = 90, now = new Date()) {
	return db
		.select({
			day: dailyStats.day,
			activeUsers: dailyStats.activeUsers,
			runsStarted: dailyStats.runsStarted,
			runsSucceeded: dailyStats.runsSucceeded,
			runsFailed: dailyStats.runsFailed,
			pullRequestsOpened: dailyStats.pullRequestsOpened,
			pullRequestsMerged: dailyStats.pullRequestsMerged,
			agentSeconds: dailyStats.agentSeconds,
		})
		.from(dailyStats)
		.where(gte(dailyStats.day, addDays(utcDay(now), -(days - 1))))
		.orderBy(asc(dailyStats.day));
}
