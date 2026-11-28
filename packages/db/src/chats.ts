import { isOwnModelKey, parseOwnModelKey } from "@nullfuse/models/providers";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import type { NewAttachment } from "./attachments";
import { chatState, chatUnread } from "./inbox";
import { attachment, chat, message, project, run, type ReasoningLevel, userModel } from "./schema";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type RunStatus = (typeof run.$inferSelect)["status"];

export const MAX_UNFINISHED_RUNS_PER_USER = 10;

export type SendResult =
	| { ok: true; chatId: string; messageId: string; runId: string }
	| { ok: false; reason: "not_found" | "disconnected" | "queue_full" | "model_removed" };

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

export async function countUnfinishedRuns(tx: Tx, userId: string) {
	const [row] = await tx
		.select({ n: count() })
		.from(run)
		.where(
			and(eq(run.userId, userId), inArray(run.status, ["queued", "running"])),
		);
	return row?.n ?? 0;
}

// A user's own model must still be theirs; the run keeps its name for later.
export async function modelFor(tx: Tx, userId: string, model: string) {
	if (!isOwnModelKey(model)) return { label: null };
	const id = parseOwnModelKey(model);
	if (!id) return null;
	const [found] = await tx
		.select({ label: userModel.label })
		.from(userModel)
		.where(and(eq(userModel.id, id), eq(userModel.userId, userId)));
	return found ?? null;
}

export async function enqueueMessage(
	tx: Tx,
	input: {
		userId: string;
		chatId: string;
		model: string;
		content: string;
		verify?: boolean;
		updateBase?: boolean;
		planOnly?: boolean;
		autoFix?: boolean;
		reasoning?: ReasoningLevel;
		modelLabel: string | null;
		attachments?: NewAttachment[];
	},
) {
	const msg = one(
		await tx
			.insert(message)
			.values({ chatId: input.chatId, role: "user", content: input.content })
			.returning({ id: message.id }),
	);
	if (input.attachments?.length) {
		await tx.insert(attachment).values(
			input.attachments.map((file, position) => ({
				...file,
				messageId: msg.id,
				position,
				size: file.data.length,
			})),
		);
	}
	const queued = one(
		await tx
			.insert(run)
			.values({
				chatId: input.chatId,
				messageId: msg.id,
				userId: input.userId,
				model: input.model,
				modelLabel: input.modelLabel,
				verify: input.verify ?? false,
				updateBase: input.updateBase ?? false,
				planOnly: input.planOnly ?? false,
				autoFix: input.autoFix ?? false,
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
		planOnly?: boolean;
		reasoning?: ReasoningLevel;
		issueNumber?: number;
		attachments?: NewAttachment[];
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
		const picked = await modelFor(tx, input.userId, input.model);
		if (!picked) return { ok: false, reason: "model_removed" };

		const created = one(
			await tx
				.insert(chat)
				.values({
					userId: input.userId,
					projectId: input.projectId,
					title: titleFromMessage(input.content),
					baseBranch: input.baseBranch,
					issueNumber: input.issueNumber,
				})
				.returning({ id: chat.id }),
		);
		const ids = await enqueueMessage(tx, { ...input, chatId: created.id, modelLabel: picked.label });
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
		updateBase?: boolean;
		planOnly?: boolean;
		reasoning?: ReasoningLevel;
		attachments?: NewAttachment[];
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
		const picked = await modelFor(tx, input.userId, input.model);
		if (!picked) return { ok: false, reason: "model_removed" };

		const ids = await enqueueMessage(tx, { ...input, modelLabel: picked.label });
		await tx
			.update(chat)
			.set({ updatedAt: new Date(), autoFixNote: null })
			.where(eq(chat.id, input.chatId));
		return { ok: true, chatId: input.chatId, ...ids };
	});
}

// A waiting run is briefly "running" each time it tries to start. It is shown as queued.
const shownStatus = sql<RunStatus>`case
	when "run"."status" = 'running' and "run"."waiting_since" is not null then 'queued'
	else "run"."status"
end`;

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
				select ${shownStatus} from ${run}
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
			issueNumber: chat.issueNumber,
			pullRequestNumber: chat.pullRequestNumber,
			pullRequestUrl: chat.pullRequestUrl,
			pullRequestError: chat.pullRequestError,
			autoFix: sql<boolean>`${chat.autoFixSince} is not null`,
			autoFixNote: chat.autoFixNote,
			projectId: chat.projectId,
			projectName: project.fullName,
			installationId: project.installationId,
			state: chatState,
			unread: chatUnread,
			connected: sql<boolean>`${project.installationId} is not null`,
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
			modelLabel: run.modelLabel,
			reasoning: run.reasoning,
			cachedInputTokens: run.cachedInputTokens,
			reasoningTokens: run.reasoningTokens,
			status: shownStatus,
			stopReason: run.stopReason,
			error: run.error,
			changedFiles: run.changedFiles,
			verify: run.verify,
			planOnly: run.planOnly,
			autoFix: run.autoFix,
			recording: run.recording,
			verification: run.verification,
			stopRequestedAt: run.stopRequestedAt,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			modelCost: run.modelCost,
			sandboxCost: run.sandboxCost,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			createdAt: run.createdAt,
		})
		.from(run)
		.where(and(eq(run.chatId, chatId), eq(run.userId, userId)))
		.orderBy(asc(run.createdAt));
}

/** False when the chat is not the user's. Renaming does not count as activity. */
export async function renameChat(db: Db, userId: string, chatId: string, title: string) {
	const clean = title.replace(/\s+/g, " ").trim().slice(0, 80);
	if (!clean) return false;
	const rows = await db
		.update(chat)
		.set({ title: clean, updatedAt: sql`${chat.updatedAt}` })
		.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
		.returning({ id: chat.id });
	return rows.length > 0;
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

export type Overlap = { chatId: string; title: string; files: string[] };

/**
 * Other open chats in the same project whose runs changed files this chat changed too,
 * so a conflict can be expected. Runs that only merged the base branch are left out.
 */
export async function listOverlaps(db: Db, userId: string, chatId: string): Promise<Overlap[]> {
	const rows = await db
		.select({ chatId: chat.id, title: chat.title, state: chatState, files: run.changedFiles })
		.from(chat)
		.innerJoin(run, and(eq(run.chatId, chat.id), eq(run.updateBase, false)))
		.where(
			and(
				eq(chat.userId, userId),
				sql`${chat.projectId} = (select c.project_id from chat c where c.id = ${chatId} and c.user_id = ${userId})`,
			),
		)
		.orderBy(desc(chat.updatedAt));

	const mine = new Set(rows.filter((row) => row.chatId === chatId).flatMap((row) => row.files.map((f) => f.path)));
	const others = new Map<string, { title: string; files: Set<string> }>();
	for (const row of rows) {
		if (row.chatId === chatId || row.state === "done") continue;
		for (const { path } of row.files) {
			if (!mine.has(path)) continue;
			const found = others.get(row.chatId) ?? { title: row.title, files: new Set<string>() };
			others.set(row.chatId, found);
			found.files.add(path);
		}
	}
	return [...others].map(([id, { title, files }]) => ({ chatId: id, title, files: [...files].sort() }));
}
