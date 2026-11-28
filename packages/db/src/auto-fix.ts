import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { countUnfinishedRuns, enqueueMessage, MAX_UNFINISHED_RUNS_PER_USER, modelFor } from "./chats";
import type { Db } from "./index";
import { autoFixSeen, chat, project, run } from "./schema";

/** False when the chat is not the user's or has no pull request. Turning it on resets its limits. */
export async function setAutoFix(db: Db, userId: string, chatId: string, on: boolean) {
	const rows = await db
		.update(chat)
		.set({
			// Cut to milliseconds, so the value survives a round trip through a Date.
			autoFixSince: on ? sql`date_trunc('milliseconds', now())` : null,
			autoFixCheckedAt: null,
			autoFixNote: null,
		})
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId), isNotNull(chat.pullRequestNumber)))
		.returning({ id: chat.id });
	return rows.length === 1;
}

export type AutoFixChat = {
	chatId: string;
	userId: string;
	since: Date;
	pullRequestNumber: number;
	baseBranch: string;
	fullName: string;
	installationId: number;
};

/** Idle chats not looked at lately, longest ago first. Each is marked as looked at. */
export async function takeAutoFixDue(
	db: Db,
	options: { olderThanMs: number; limit: number; userId?: string },
): Promise<AutoFixChat[]> {
	const cutoff = new Date(Date.now() - options.olderThanMs).toISOString();
	const rows = await db
		.select({
			chatId: chat.id,
			userId: chat.userId,
			since: chat.autoFixSince,
			pullRequestNumber: chat.pullRequestNumber,
			baseBranch: chat.baseBranch,
			fullName: project.fullName,
			installationId: project.installationId,
		})
		.from(chat)
		.innerJoin(project, eq(project.id, chat.projectId))
		.where(
			and(
				isNotNull(chat.autoFixSince),
				isNotNull(chat.pullRequestNumber),
				isNotNull(project.installationId),
				options.userId === undefined ? undefined : eq(chat.userId, options.userId),
				sql`(${chat.autoFixCheckedAt} is null or ${chat.autoFixCheckedAt} <= ${cutoff}::timestamptz)`,
				sql`not exists (select 1 from run r where r.chat_id = "chat"."id" and r.status in ('queued', 'running'))`,
			),
		)
		.orderBy(sql`${chat.autoFixCheckedAt} asc nulls first`, asc(chat.id))
		.limit(options.limit);

	for (const row of rows) {
		await db
			.update(chat)
			.set({ autoFixCheckedAt: new Date(), updatedAt: sql`${chat.updatedAt}` })
			.where(eq(chat.id, row.chatId));
	}
	return rows.flatMap(({ since, pullRequestNumber, installationId, ...rest }) =>
		since && pullRequestNumber !== null && installationId !== null
			? [{ ...rest, since, pullRequestNumber, installationId }]
			: [],
	);
}

export async function listAutoFixSeen(db: Db, chatId: string) {
	const rows = await db.select({ key: autoFixSeen.key }).from(autoFixSeen).where(eq(autoFixSeen.chatId, chatId));
	return new Set(rows.map((row) => row.key));
}

export async function markAutoFixSeen(db: Db, chatId: string, keys: string[]) {
	if (keys.length === 0) return;
	await db
		.insert(autoFixSeen)
		.values(keys.map((key) => ({ chatId, key })))
		.onConflictDoNothing();
}

export async function turnOffAutoFix(db: Db, chatId: string, note: string | null) {
	await db
		.update(chat)
		.set({ autoFixSince: null, autoFixNote: note, updatedAt: sql`${chat.updatedAt}` })
		.where(eq(chat.id, chatId));
}

export type AutoFixResult =
	| { ok: true; chatId: string; runId: string }
	| {
			ok: false;
			reason: "off" | "busy" | "seen" | "stopped" | "limit" | "budget" | "queue_full" | "model_removed";
	  };

/**
 * Queues one automatic run. The checks and the insert share the chat's lock, so two sweeps
 * cannot send the same thing, and no run starts past the limits.
 */
export function queueAutoFixRun(
	db: Db,
	input: {
		chatId: string;
		since: Date;
		keys: string[];
		content: string;
		updateBase?: boolean;
		/** Automatic runs allowed since the user's last message. */
		maxRuns: number;
		/** Spend allowed for automatic runs since auto-fix was turned on, in millionths of a dollar. */
		maxCost: number;
	},
) {
	return db.transaction(async (tx): Promise<AutoFixResult> => {
		const [found] = await tx
			.select({ userId: chat.userId, since: chat.autoFixSince })
			.from(chat)
			.where(eq(chat.id, input.chatId))
			.for("update");
		if (!found?.since || found.since.getTime() !== input.since.getTime()) return { ok: false, reason: "off" };

		const runs = await tx
			.select({
				status: run.status,
				autoFix: run.autoFix,
				model: run.model,
				reasoning: run.reasoning,
				cost: sql<number>`${run.modelCost} + ${run.sandboxCost}`.mapWith(Number),
				sinceOn: sql<boolean>`${run.createdAt} >= (select c.auto_fix_since from chat c where c.id = ${input.chatId})`,
			})
			.from(run)
			.where(eq(run.chatId, input.chatId))
			.orderBy(desc(run.createdAt), desc(run.id));
		const latest = runs[0];
		if (!latest) return { ok: false, reason: "off" };
		if (runs.some((r) => r.status === "queued" || r.status === "running")) return { ok: false, reason: "busy" };

		const pause = async (reason: "limit" | "budget" | "model_removed", note: string): Promise<AutoFixResult> => {
			await tx
				.update(chat)
				.set({ autoFixNote: note, updatedAt: sql`${chat.updatedAt}` })
				.where(eq(chat.id, input.chatId));
			return { ok: false, reason };
		};

		if (latest.autoFix && latest.sinceOn && latest.status === "cancelled") {
			await tx
				.update(chat)
				.set({ autoFixSince: null, autoFixNote: "Turned off because you stopped an automatic run." })
				.where(eq(chat.id, input.chatId));
			return { ok: false, reason: "stopped" };
		}

		const mine = runs.filter((r) => r.sinceOn);
		const human = mine.findIndex((r) => !r.autoFix);
		const inARow = human === -1 ? mine.length : human;
		if (inARow >= input.maxRuns) {
			return pause("limit", `Paused after ${inARow} automatic runs in a row. Send a message to continue.`);
		}
		const spent = mine.reduce((sum, r) => sum + (r.autoFix ? r.cost : 0), 0);
		if (spent >= input.maxCost) {
			return pause("budget", "Paused: automatic runs used their budget. Turn auto-fix off and on to allow more.");
		}
		if ((await countUnfinishedRuns(tx, found.userId)) >= MAX_UNFINISHED_RUNS_PER_USER) {
			return { ok: false, reason: "queue_full" };
		}
		const picked = await modelFor(tx, found.userId, latest.model);
		if (!picked) {
			return pause("model_removed", "Paused: the chat's model was removed. Send a message with another one.");
		}

		const fresh = await tx
			.insert(autoFixSeen)
			.values(input.keys.map((key) => ({ chatId: input.chatId, key })))
			.onConflictDoNothing()
			.returning({ key: autoFixSeen.key });
		if (fresh.length === 0) return { ok: false, reason: "seen" };

		const { runId } = await enqueueMessage(tx, {
			userId: found.userId,
			chatId: input.chatId,
			model: latest.model,
			reasoning: latest.reasoning,
			content: input.content,
			updateBase: input.updateBase,
			verify: input.updateBase,
			autoFix: true,
			modelLabel: picked.label,
		});
		await tx.update(chat).set({ updatedAt: new Date(), autoFixNote: null }).where(eq(chat.id, input.chatId));
		return { ok: true, chatId: input.chatId, runId };
	});
}
