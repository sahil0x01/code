import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { chat, preview, project, projectEnvVar, run } from "./schema";

// A worker that has not reported for this long is gone.
const WORKER_SILENT_MS = 2 * 60_000;

export type PreviewRequest =
	| { ok: true; start: false }
	| { ok: true; start: true; generation: string }
	| { ok: false; reason: "not_found" | "not_set_up" | "no_branch" | "disconnected" };

const live = ["starting", "ready"] as const;

/** Wakes the chat's preview. `start` says a worker has to be sent for it. */
export function requestPreview(db: Db, userId: string, chatId: string) {
	return db.transaction(async (tx): Promise<PreviewRequest> => {
		const [target] = await tx
			.select({
				workingBranch: chat.workingBranch,
				startCommand: project.startCommand,
				appPort: project.appPort,
				installationId: project.installationId,
			})
			.from(chat)
			.innerJoin(project, eq(project.id, chat.projectId))
			.where(and(eq(chat.id, chatId), eq(chat.userId, userId)))
			.for("update", { of: chat });
		if (!target) return { ok: false, reason: "not_found" };
		if (target.installationId === null) return { ok: false, reason: "disconnected" };
		if (!target.startCommand || target.appPort === null) return { ok: false, reason: "not_set_up" };
		if (!target.workingBranch) return { ok: false, reason: "no_branch" };

		const now = new Date();
		const [current] = await tx.select().from(preview).where(eq(preview.chatId, chatId));
		if (current && (current.status === "starting" || current.status === "ready")) {
			const alive = now.getTime() - current.updatedAt.getTime() < WORKER_SILENT_MS;
			// A run that finished since the preview started left newer code on the branch.
			const [newer] = await tx
				.select({ id: run.id })
				.from(run)
				.where(and(eq(run.chatId, chatId), sql`${run.finishedAt} > ${current.createdAt.toISOString()}::timestamptz`))
				.limit(1);
			if (alive && !newer) {
				await tx.update(preview).set({ lastSeenAt: now }).where(eq(preview.chatId, chatId));
				return { ok: true, start: false };
			}
		}

		const fresh = {
			generation: randomUUID(),
			status: "starting" as const,
			url: null,
			error: null,
			expiresAt: null,
			lastSeenAt: now,
			updatedAt: now,
			createdAt: now,
		};
		await tx
			.insert(preview)
			.values({ chatId, ...fresh })
			.onConflictDoUpdate({ target: preview.chatId, set: fresh });
		return { ok: true, start: true, generation: fresh.generation };
	});
}

const owned = (userId: string, chatId: string) =>
	and(
		eq(preview.chatId, chatId),
		sql`exists (select 1 from chat c where c.id = ${preview.chatId} and c.user_id = ${userId})`,
	);

/** Reads the preview for its owner and notes that the page is open. */
export async function viewPreview(db: Db, userId: string, chatId: string) {
	const [row] = await db
		.update(preview)
		.set({ lastSeenAt: new Date() })
		.where(owned(userId, chatId))
		.returning();
	return row ?? null;
}

export async function stopPreview(db: Db, userId: string, chatId: string) {
	await db
		.update(preview)
		.set({ status: "stopped", url: null })
		.where(and(owned(userId, chatId), inArray(preview.status, [...live])));
}

const mine = (chatId: string, generation: string) =>
	and(eq(preview.chatId, chatId), eq(preview.generation, generation), inArray(preview.status, [...live]));

/** The worker's heartbeat. Null means this preview was stopped, replaced or deleted. */
export async function keepPreview(db: Db, chatId: string, generation: string) {
	const [row] = await db
		.update(preview)
		.set({ updatedAt: new Date() })
		.where(mine(chatId, generation))
		.returning({ lastSeenAt: preview.lastSeenAt });
	return row ?? null;
}

export async function setPreviewReady(
	db: Db,
	chatId: string,
	generation: string,
	ready: { url: string; expiresAt: Date },
) {
	const rows = await db
		.update(preview)
		.set({ ...ready, status: "ready", updatedAt: new Date() })
		.where(mine(chatId, generation))
		.returning({ chatId: preview.chatId });
	return rows.length === 1;
}

export async function endPreview(
	db: Db,
	chatId: string,
	generation: string,
	end: { status: "stopped" } | { status: "failed"; error: string },
) {
	await db
		.update(preview)
		.set({ ...end, url: null, updatedAt: new Date() })
		.where(mine(chatId, generation));
}

export async function loadPreviewContext(db: Db, chatId: string) {
	const [row] = await db
		.select({
			baseBranch: chat.baseBranch,
			workingBranch: chat.workingBranch,
			project: {
				id: project.id,
				fullName: project.fullName,
				installationId: project.installationId,
				installCommand: project.installCommand,
				startCommand: project.startCommand,
				appPort: project.appPort,
			},
		})
		.from(chat)
		.innerJoin(project, eq(project.id, chat.projectId))
		.where(eq(chat.id, chatId));
	if (!row) return null;
	const envVars = await db
		.select({ name: projectEnvVar.name, valueEncrypted: projectEnvVar.valueEncrypted })
		.from(projectEnvVar)
		.where(eq(projectEnvVar.projectId, row.project.id));
	return { ...row, envVars };
}
