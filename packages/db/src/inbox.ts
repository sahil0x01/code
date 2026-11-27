import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import { chat, run } from "./schema";

export type ChatReviewState = "running" | "needs_review" | "done";

// Table names are written out because these run as subqueries of a query on `chat`.
// A run cancelled before it started did no work, so there is nothing to review.
export const chatState = sql<ChatReviewState>`case
	when exists (
		select 1 from run r where r.chat_id = "chat"."id" and r.status in ('queued', 'running')
	) then 'running'
	when exists (
		select 1 from run r where r.chat_id = "chat"."id" and r.started_at is not null
		and r.finished_at > coalesce("chat"."done_at", '-infinity')
	) then 'needs_review'
	else 'done'
end`;

export const chatUnread = sql<boolean>`exists (
	select 1 from run r where r.chat_id = "chat"."id" and r.status in ('succeeded', 'failed')
	and r.finished_at > coalesce("chat"."seen_at", '-infinity')
)`;

/** Marks results up to `until` as read. Never moves backwards, so a late call hides nothing newer. */
export async function markChatSeen(db: Db, userId: string, chatId: string, until: Date) {
	await db
		.update(chat)
		.set({ seenAt: sql`greatest(${chat.seenAt}, ${until.toISOString()}::timestamptz)` })
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

export async function setChatDone(db: Db, userId: string, chatId: string, done: boolean) {
	const now = new Date();
	const rows = await db
		.update(chat)
		.set(done ? { doneAt: now, seenAt: now } : { doneAt: null })
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
		.returning({ id: chat.id });
	return rows.length === 1;
}

/** Marks a chat done because its pull request was merged. Later runs ask for review again. */
export async function markChatMerged(db: Db, userId: string, chatId: string) {
	const now = new Date();
	await db
		.update(chat)
		.set({ doneAt: now, seenAt: now })
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId), isNull(chat.doneAt)));
}

/** The same, for a merge GitHub reports. */
export async function markPullMerged(
	db: Db,
	installationId: number,
	githubRepoId: number,
	number: number,
	size: { additions?: number; deletions?: number } = {},
) {
	const now = new Date();
	const isThisPull = and(
		eq(chat.pullRequestNumber, number),
		sql`exists (select 1 from project p where p.id = ${chat.projectId}
			and p.installation_id = ${installationId} and p.github_repo_id = ${githubRepoId})`,
	);
	// Kept apart from the review state below: a chat marked done by hand still counts as merged.
	await db
		.update(chat)
		.set({
			pullRequestMergedAt: now,
			pullRequestAdditions: size.additions ?? null,
			pullRequestDeletions: size.deletions ?? null,
		})
		.where(and(isThisPull, isNull(chat.pullRequestMergedAt)));
	await db
		.update(chat)
		.set({ doneAt: now, seenAt: now })
		.where(and(isThisPull, isNull(chat.doneAt)));
}

export type FinishedRun = {
	runId: string;
	chatId: string;
	title: string;
	status: "succeeded" | "failed";
};

export type Inbox = {
	queued: number;
	running: number;
	needsReview: number;
	unread: number;
	/** Newest first, from the last day. */
	finished: FinishedRun[];
};

export async function getInbox(db: Db, userId: string): Promise<Inbox> {
	const [chats] = await db
		.select({
			needsReview: sql<number>`(count(*) filter (where ${chatState} = 'needs_review'))::int`,
			unread: sql<number>`(count(*) filter (where ${chatUnread}))::int`,
		})
		.from(chat)
		.where(eq(chat.userId, userId));

	const [runs] = await db
		.select({
			queued: sql<number>`(count(*) filter (where ${run.status} = 'queued'))::int`,
			running: sql<number>`(count(*) filter (where ${run.status} = 'running'))::int`,
		})
		.from(run)
		.where(and(eq(run.userId, userId), inArray(run.status, ["queued", "running"])));

	const finished = await db
		.select({
			runId: run.id,
			chatId: run.chatId,
			title: chat.title,
			status: sql<FinishedRun["status"]>`${run.status}`,
		})
		.from(run)
		.innerJoin(chat, eq(chat.id, run.chatId))
		.where(
			and(
				eq(run.userId, userId),
				inArray(run.status, ["succeeded", "failed"]),
				sql`${run.finishedAt} > now() - interval '1 day'`,
			),
		)
		.orderBy(desc(run.finishedAt))
		.limit(50);

	return {
		queued: runs?.queued ?? 0,
		running: runs?.running ?? 0,
		needsReview: chats?.needsReview ?? 0,
		unread: chats?.unread ?? 0,
		finished,
	};
}
