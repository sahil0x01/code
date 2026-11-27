import { randomInt } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/fixtures";
import {
	chat,
	createChat,
	dailyStats,
	markChatMerged,
	markPullMerged,
	project,
	refreshDailyStats,
	runStep,
	setPullRequest,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

// Other tests write rows dated today, so these use a day of their own far in the past.
const year = randomInt(1950, 2000);
const day = `${year}-03-1${randomInt(0, 9)}`;
const otherDay = `${year}-07-1${randomInt(0, 9)}`;

afterAll(async () => {
	await db.delete(dailyStats).where(inArray(dailyStats.day, [day, otherDay]));
	await fixtures.cleanup();
	await db.$client.end();
});

async function seed(on: string) {
	const at = (time: string) => `${on}T${time}Z`;
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const created = await createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "deepseek-v4-pro",
		content: "Fix the test",
	});
	if (!created.ok) throw new Error(created.reason);
	const { chatId, runId } = created;

	const q = (text: string, values: unknown[]) => db.$client.query(text, values);
	await q(`update "user" set created_at = $2 where id = $1`, [userId, at("08:00:00")]);
	await q(`update project set created_at = $2 where id = $1`, [projectId, at("08:05:00")]);
	await q(`update chat set created_at = $2 where id = $1`, [chatId, at("09:00:00")]);
	await q(
		`update run set status = 'succeeded', created_at = $2, started_at = $2, finished_at = $3,
			input_tokens = 1000, output_tokens = 200, cached_input_tokens = 600,
			changed_files = '[{"path":"a.ts","status":"modified"},{"path":"b.ts","status":"added"}]',
			verification = '{"command":"pnpm test","exitCode":0,"timedOut":false,"durationMs":10,"output":""}'
		where id = $1`,
		[runId, at("09:00:00"), at("09:30:00")],
	);
	await db.insert(runStep).values({
		runId,
		stepIndex: 0,
		finishReason: "tool-calls",
		toolCalls: [
			{ id: "1", name: "read", input: {} },
			{ id: "2", name: "edit", input: {} },
		],
	});
	await q(`update run_step set created_at = $2 where run_id = $1`, [runId, at("09:10:00")]);

	await setPullRequest(db, chatId, { number: 7, url: "https://github.com/acme/app/pull/7" });
	const [row] = await db.select().from(project).where(eq(project.id, projectId));
	if (!row?.installationId) throw new Error("no installation");
	return { userId, chatId, runId, installationId: row.installationId, repoId: row.githubRepoId };
}

describe("merged pull requests", () => {
	it("keep the size GitHub reported, even when the chat was already marked done by hand", async () => {
		const { userId, chatId, installationId, repoId } = await seed(otherDay);
		await markChatMerged(db, userId, chatId);
		await markPullMerged(db, installationId, repoId, 7, { additions: 120, deletions: 30 });
		// A repeated delivery keeps the first record.
		await markPullMerged(db, installationId, repoId, 7, { additions: 1, deletions: 1 });

		const [row] = await db.select().from(chat).where(eq(chat.id, chatId));
		expect(row?.pullRequestOpenedAt).toBeInstanceOf(Date);
		expect(row?.pullRequestMergedAt).toBeInstanceOf(Date);
		expect([row?.pullRequestAdditions, row?.pullRequestDeletions]).toEqual([120, 30]);
	});
});

describe("daily stats", () => {
	it("count a day's work and give the same row when run again", async () => {
		const { chatId, installationId, repoId } = await seed(day);
		await markPullMerged(db, installationId, repoId, 7, { additions: 40, deletions: 4 });
		await db.$client.query(
			`update chat set pull_request_opened_at = $2, pull_request_merged_at = $2 where id = $1`,
			[chatId, `${day}T10:00:00Z`],
		);

		await refreshDailyStats(db, day, day);
		await refreshDailyStats(db, day, day);
		const rows = await db.select().from(dailyStats).where(eq(dailyStats.day, day));

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			usersJoined: 1,
			activeUsers: 1,
			projectsConnected: 1,
			chatsStarted: 1,
			runsStarted: 1,
			runsSucceeded: 1,
			runsFailed: 0,
			agentSeconds: 1800,
			steps: 1,
			toolCalls: 2,
			fileEdits: 2,
			inputTokens: 1000,
			outputTokens: 200,
			cachedInputTokens: 600,
			runsVerified: 1,
			runsVerifiedPassed: 1,
			pullRequestsOpened: 1,
			pullRequestsMerged: 1,
			linesAdded: 40,
			linesRemoved: 4,
		});
	});
});
