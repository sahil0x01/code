import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { countUnfinishedRuns, enqueueMessage, MAX_UNFINISHED_RUNS_PER_USER, modelFor } from "./chats";
import type { Db } from "./index";
import { chat, project, run } from "./schema";

const idle = sql`not exists (select 1 from run r where r.chat_id = "chat"."id" and r.status in ('queued', 'running'))`;
const unchangedTime = sql`${chat.updatedAt}`;

/** Starts a merge of the approved commit. False unless the chat is the user's, has a pull request and is idle. */
export async function requestMerge(db: Db, userId: string, chatId: string, sha: string) {
	const rows = await db
		.update(chat)
		.set({
			// Cut to milliseconds, so the value survives a round trip through a Date.
			mergeSince: sql`date_trunc('milliseconds', now())`,
			mergeSha: sha,
			mergeUpdatedFrom: null,
			mergeFixes: 0,
			mergeRunId: null,
			mergeFixHead: null,
			mergeCheckedAt: null,
			mergeNote: null,
		})
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId), isNotNull(chat.pullRequestNumber), idle))
		.returning({ id: chat.id });
	return rows.length === 1;
}

export async function cancelMerge(db: Db, userId: string, chatId: string) {
	await db
		.update(chat)
		.set({ mergeSince: null, mergeNote: null, updatedAt: unchangedTime })
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
}

/** Ends this merge. A note says why it did not happen, and marks the chat unread. */
export async function endMerge(db: Db, chatId: string, since: Date, note: string | null) {
	await db
		.update(chat)
		.set({ mergeSince: null, mergeNote: note, updatedAt: unchangedTime, ...(note !== null && { seenAt: null }) })
		.where(and(eq(chat.id, chatId), eq(chat.mergeSince, since)));
}

export async function advanceMerge(
	db: Db,
	chatId: string,
	since: Date,
	change: { mergeSha?: string; mergeUpdatedFrom: string | null },
) {
	await db
		.update(chat)
		.set({ ...change, updatedAt: unchangedTime })
		.where(and(eq(chat.id, chatId), eq(chat.mergeSince, since)));
}

/** The chat's waiting merge, or null when there is none or a run is still working. */
export async function getPendingMerge(db: Db, chatId: string) {
	const [row] = await db
		.select({
			userId: chat.userId,
			since: chat.mergeSince,
			sha: chat.mergeSha,
			updatedFrom: chat.mergeUpdatedFrom,
			fixes: chat.mergeFixes,
			fixHead: chat.mergeFixHead,
			runStatus: run.status,
			runFinishedAt: run.finishedAt,
			pullRequestNumber: chat.pullRequestNumber,
			baseBranch: chat.baseBranch,
			fullName: project.fullName,
			installationId: project.installationId,
		})
		.from(chat)
		.innerJoin(project, eq(project.id, chat.projectId))
		.leftJoin(run, eq(run.id, chat.mergeRunId))
		.where(and(eq(chat.id, chatId), idle));
	if (!row) return null;
	const { since, sha, pullRequestNumber, installationId, runStatus, runFinishedAt, ...rest } = row;
	if (!since || !sha || pullRequestNumber === null || installationId === null) return null;
	const fixRun = runStatus === null ? null : { status: runStatus, finishedAt: runFinishedAt };
	return { ...rest, chatId, since, sha, pullRequestNumber, installationId, fixRun };
}

/** Idle chats waiting to merge and not looked at lately, longest ago first. Each is marked as looked at. */
export async function takeMergesDue(db: Db, options: { olderThanMs: number; limit: number; userId?: string }) {
	const cutoff = new Date(Date.now() - options.olderThanMs).toISOString();
	const rows = await db
		.select({ chatId: chat.id })
		.from(chat)
		.where(
			and(
				isNotNull(chat.mergeSince),
				options.userId === undefined ? undefined : eq(chat.userId, options.userId),
				sql`(${chat.mergeCheckedAt} is null or ${chat.mergeCheckedAt} <= ${cutoff}::timestamptz)`,
				idle,
			),
		)
		.orderBy(sql`${chat.mergeCheckedAt} asc nulls first`, asc(chat.id))
		.limit(options.limit);
	for (const { chatId } of rows) {
		await db
			.update(chat)
			.set({ mergeCheckedAt: new Date(), updatedAt: unchangedTime })
			.where(eq(chat.id, chatId));
	}
	return rows.map((row) => row.chatId);
}

export type MergeFixResult =
	| { ok: true; chatId: string; runId: string }
	| { ok: false; reason: "off" | "busy" | "queue_full" | "model_removed" };

/**
 * Queues a run that fixes what stands in the way of a merge. The checks and the insert share
 * the chat's lock, so two callers cannot both queue one.
 */
export function queueMergeFix(
	db: Db,
	input: { chatId: string; since: Date; fixes: number; head: string; content: string; updateBase?: boolean },
) {
	return db.transaction(async (tx): Promise<MergeFixResult> => {
		const [found] = await tx
			.select({ userId: chat.userId, since: chat.mergeSince, fixes: chat.mergeFixes })
			.from(chat)
			.where(eq(chat.id, input.chatId))
			.for("update");
		if (!found?.since || found.since.getTime() !== input.since.getTime()) return { ok: false, reason: "off" };
		const runs = await tx
			.select({ status: run.status, model: run.model, reasoning: run.reasoning })
			.from(run)
			.where(eq(run.chatId, input.chatId))
			.orderBy(asc(run.createdAt), asc(run.id));
		const latest = runs.at(-1);
		if (!latest) return { ok: false, reason: "off" };
		if (found.fixes !== input.fixes || runs.some((r) => r.status === "queued" || r.status === "running")) {
			return { ok: false, reason: "busy" };
		}
		if ((await countUnfinishedRuns(tx, found.userId)) >= MAX_UNFINISHED_RUNS_PER_USER) {
			return { ok: false, reason: "queue_full" };
		}
		const picked = await modelFor(tx, found.userId, latest.model);
		if (!picked) return { ok: false, reason: "model_removed" };

		const { runId } = await enqueueMessage(tx, {
			userId: found.userId,
			chatId: input.chatId,
			model: latest.model,
			reasoning: latest.reasoning,
			content: input.content,
			updateBase: input.updateBase,
			verify: input.updateBase,
			modelLabel: picked.label,
		});
		await tx
			.update(chat)
			.set({
				mergeFixes: found.fixes + 1,
				mergeRunId: runId,
				mergeFixHead: input.head,
				updatedAt: new Date(),
			})
			.where(eq(chat.id, input.chatId));
		return { ok: true, chatId: input.chatId, runId };
	});
}
