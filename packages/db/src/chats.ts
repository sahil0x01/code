import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { chatState, chatUnread } from "./inbox";
import { chat, message, project, run, type ReasoningLevel } from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RunStatus = (typeof run.$inferSelect)["status"];

export const MAX_UNFINISHED_RUNS_PER_USER = 10;

export type SendResult =
	| { ok: true; chatId: string; messageId: string; runId: string }
	| { ok: false; reason: "not_found" | "disconnected" | "queue_full" };

function one<T>(rows: T[]): T {
	const row = rows[0];
	if (!row) throw new Error("Expected one row");
	return row;
}

export function titleFromMessage(content: string) {
	const firstLine =
		content.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
	if (firstLine === "") return "New chat";
	return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
}

async function countUnfinishedRuns(tx: Tx, userId: string) {
	const [row] = await tx
		.select({ n: count() })
		.from(run)
		.where(
			and(eq(run.userId, userId), inArray(run.status, ["queued", "running"])),
		);
	return row?.n ?? 0;
}

async function enqueue(
	tx: Tx,
	input: {
		userId: string;
		chatId: string;
		model: string;
		content: string;
		verify?: boolean;
		record?: boolean;
		reasoning?: ReasoningLevel;
	},
) {
	const msg = one(
		await tx
			.insert(message)
			.values({ chatId: input.chatId, role: "user", content: input.content })
			.returning({ id: message.id }),
	);
	const queued = one(
		await tx
			.insert(run)
			.values({
				chatId: input.chatId,
				messageId: msg.id,
				userId: input.userId,
				model: input.model,
				verify: input.verify ?? false,
				record: input.record ?? false,
				reasoning: input.reasoning,
			})
			.returning({ id: run.id }),
	);
	return { messageId: msg.id, runId: queued.id };
}

export function createChat(
	db: Db,
	input: {
		userId: string;
		projectId: string;
		baseBranch: string;
		model: string;
		content: string;
		verify?: boolean;
		record?: boolean;
		reasoning?: ReasoningLevel;
	},
) {
	return db.transaction(async (tx): Promise<SendResult> => {
		const [owned] = await tx
			.select({ installationId: project.installationId })
			.from(project)
			.where(
				and(eq(project.id, input.projectId), eq(project.userId, input.userId)),
			);
		if (!owned) return { ok: false, reason: "not_found" };
		if (owned.installationId === null) {
			return { ok: false, reason: "disconnected" };
		}
		if (
			(await countUnfinishedRuns(tx, input.userId)) >=
			MAX_UNFINISHED_RUNS_PER_USER
		) {
			return { ok: false, reason: "queue_full" };
		}

		const created = one(
			await tx
				.insert(chat)
				.values({
					userId: input.userId,
					projectId: input.projectId,
					title: titleFromMessage(input.content),
					baseBranch: input.baseBranch,
				})
				.returning({ id: chat.id }),
		);
		const ids = await enqueue(tx, { ...input, chatId: created.id });
		return { ok: true, chatId: created.id, ...ids };
	});
}

export function addMessage(
	db: Db,
	input: {
		userId: string;
		chatId: string;
		model: string;
		content: string;
		verify?: boolean;
		record?: boolean;
		reasoning?: ReasoningLevel;
	},
) {
	return db.transaction(async (tx): Promise<SendResult> => {
		const [found] = await tx
			.select({ installationId: project.installationId })
			.from(chat)
			.innerJoin(project, eq(chat.projectId, project.id))
			.where(and(eq(chat.id, input.chatId), eq(chat.userId, input.userId)))
			.for("update", { of: chat });
		if (!found) return { ok: false, reason: "not_found" };
		if (found.installationId === null) {
			return { ok: false, reason: "disconnected" };
		}
		if (
			(await countUnfinishedRuns(tx, input.userId)) >=
			MAX_UNFINISHED_RUNS_PER_USER
		) {
			return { ok: false, reason: "queue_full" };
		}

		const ids = await enqueue(tx, input);
		await tx
			.update(chat)
			.set({ updatedAt: new Date() })
			.where(eq(chat.id, input.chatId));
		return { ok: true, chatId: input.chatId, ...ids };
	});
}

export function listChats(
	db: Db,
	userId: string,
	opts: { projectId?: string; limit?: number } = {},
) {
	return db
		.select({
			id: chat.id,
			title: chat.title,
			baseBranch: chat.baseBranch,
			updatedAt: chat.updatedAt,
			projectId: chat.projectId,
			projectName: project.fullName,
			state: chatState,
			unread: chatUnread,
			lastRunStatus: sql<RunStatus | null>`(
				select ${run.status} from ${run}
				where ${run.chatId} = ${chat.id}
				order by ${run.createdAt} desc
				limit 1
			)`,
		})
		.from(chat)
		.innerJoin(project, eq(chat.projectId, project.id))
		.where(
			and(
				eq(chat.userId, userId),
				opts.projectId ? eq(chat.projectId, opts.projectId) : undefined,
			),
		)
		.orderBy(desc(chat.updatedAt))
		.limit(opts.limit ?? 50);
}

export async function getChatForUser(db: Db, userId: string, chatId: string) {
	const [row] = await db
		.select({
			id: chat.id,
			title: chat.title,
			baseBranch: chat.baseBranch,
			workingBranch: chat.workingBranch,
			pullRequestNumber: chat.pullRequestNumber,
			pullRequestUrl: chat.pullRequestUrl,
			pullRequestError: chat.pullRequestError,
			projectId: chat.projectId,
			projectName: project.fullName,
			installationId: project.installationId,
			state: chatState,
			unread: chatUnread,
			connected: sql<boolean>`${project.installationId} is not null`,
			canRecord: sql<boolean>`${project.startCommand} is not null and ${project.appPort} is not null`,
		})
		.from(chat)
		.innerJoin(project, eq(chat.projectId, project.id))
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)));
	return row ?? null;
}

export function listMessages(db: Db, userId: string, chatId: string) {
	return db
		.select({
			id: message.id,
			role: message.role,
			content: message.content,
			runId: message.runId,
			createdAt: message.createdAt,
		})
		.from(message)
		.innerJoin(chat, eq(message.chatId, chat.id))
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
		.orderBy(asc(message.createdAt));
}

export function listRuns(db: Db, userId: string, chatId: string) {
	return db
		.select({
			id: run.id,
			messageId: run.messageId,
			model: run.model,
			reasoning: run.reasoning,
			cachedInputTokens: run.cachedInputTokens,
			reasoningTokens: run.reasoningTokens,
			status: run.status,
			stopReason: run.stopReason,
			error: run.error,
			changedFiles: run.changedFiles,
			verify: run.verify,
			record: run.record,
			recording: run.recording,
			verification: run.verification,
			stopRequestedAt: run.stopRequestedAt,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			createdAt: run.createdAt,
		})
		.from(run)
		.where(and(eq(run.chatId, chatId), eq(run.userId, userId)))
		.orderBy(asc(run.createdAt));
}

export type DeleteChatResult =
	| { ok: true }
	| { ok: false; reason: "not_found" | "running" };

// Deleting cascades to messages and runs. A running run owns a sandbox, so it
// has to be stopped first. The chat row is locked so a delete and a send
// cannot interleave. Phase 6: a worker must lock the chat row too when it
// moves a run from queued to running, and treat "0 rows updated" as cancelled.
export function deleteChat(db: Db, userId: string, chatId: string) {
	return db.transaction(async (tx): Promise<DeleteChatResult> => {
		const [found] = await tx
			.select({ id: chat.id })
			.from(chat)
			.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
			.for("update");
		if (!found) return { ok: false, reason: "not_found" };

		const [active] = await tx
			.select({ id: run.id })
			.from(run)
			.where(and(eq(run.chatId, chatId), eq(run.status, "running")))
			.limit(1);
		if (active) return { ok: false, reason: "running" };

		await tx.delete(chat).where(eq(chat.id, chatId));
		return { ok: true };
	});
}

// Only a queued run can be cancelled here. The status check is part of the
// UPDATE, so if a worker starts the run first this matches no row and returns
// null instead of overwriting "running". Stopping a running run is Phase 6.
export async function cancelRun(db: Db, userId: string, runId: string) {
	const now = new Date();
	const [row] = await db
		.update(run)
		.set({ status: "cancelled", finishedAt: now, updatedAt: now })
		.where(
			and(
				eq(run.id, runId),
				eq(run.userId, userId),
				eq(run.status, "queued"),
			),
		)
		.returning({ chatId: run.chatId });
	return row ?? null;
}

/** One run's recording, only for the user who owns the chat. */
export async function getRunRecording(db: Db, userId: string, chatId: string, runId: string) {
	const [row] = await db
		.select({ recording: run.recording })
		.from(run)
		.where(and(eq(run.id, runId), eq(run.chatId, chatId), eq(run.userId, userId)));
	return row?.recording ?? null;
}
