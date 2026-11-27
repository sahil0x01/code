import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
	chat,
	connection,
	connectorLinkCode,
	type ConnectorProvider,
	connectorRequest,
	project,
	run,
	user,
} from "./schema";

export const MAX_REPORT_ATTEMPTS = 5;
// A report claimed this long ago and never finished was lost with its worker.
const CLAIM_MS = 60_000;

type Identity = { provider: ConnectorProvider; workspaceId: string; externalUserId: string };

const sameIdentity = (identity: Identity) =>
	and(
		eq(connection.provider, identity.provider),
		eq(connection.workspaceId, identity.workspaceId),
		eq(connection.externalUserId, identity.externalUserId),
	);

/**
 * Links an outside account the user has just proved is theirs. Another user's link to the
 * same account is removed, with its pending replies.
 */
export function saveConnection(
	db: Db,
	input: Identity & { userId: string; workspaceName: string; tokenEncrypted?: string; projectId?: string },
) {
	return db.transaction(async (tx) => {
		await tx.delete(connection).where(and(sameIdentity(input), sql`${connection.userId} <> ${input.userId}`));
		const projects = await tx
			.select({ id: project.id })
			.from(project)
			.where(and(eq(project.userId, input.userId), isNotNull(project.installationId)))
			.limit(2);
		// With one project there is nothing to choose.
		const only = projects.length === 1 ? projects[0]?.id : undefined;
		await tx
			.insert(connection)
			.values({ ...input, projectId: input.projectId ?? only })
			.onConflictDoUpdate({
				target: [connection.provider, connection.workspaceId, connection.externalUserId],
				set: {
					workspaceName: input.workspaceName,
					tokenEncrypted: input.tokenEncrypted,
					projectId: input.projectId,
					updatedAt: new Date(),
				},
			});
	});
}

export function listConnections(db: Db, userId: string) {
	return db
		.select({
			id: connection.id,
			provider: connection.provider,
			workspaceName: connection.workspaceName,
			externalUserId: connection.externalUserId,
			projectId: connection.projectId,
			createdAt: connection.createdAt,
		})
		.from(connection)
		.where(eq(connection.userId, userId))
		.orderBy(asc(connection.createdAt));
}

/** False when the connection or the project is not the user's. */
export async function setConnectionProject(db: Db, userId: string, id: string, projectId: string) {
	const rows = await db
		.update(connection)
		.set({ projectId, updatedAt: new Date() })
		.where(
			and(
				eq(connection.id, id),
				eq(connection.userId, userId),
				sql`exists (select 1 from ${project} where ${project.id} = ${projectId} and ${project.userId} = ${userId})`,
			),
		)
		.returning({ id: connection.id });
	return rows.length > 0;
}

export async function removeConnection(db: Db, userId: string, id: string) {
	await db.delete(connection).where(and(eq(connection.id, id), eq(connection.userId, userId)));
}

export async function removeConnectionByIdentity(db: Db, identity: Identity) {
	const rows = await db.delete(connection).where(sameIdentity(identity)).returning({ id: connection.id });
	return rows.length > 0;
}

export const LINK_CODE_MINUTES = 10;

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/** A new code replaces the user's earlier one for that tool. */
export async function createLinkCode(db: Db, userId: string, provider: ConnectorProvider) {
	const code = randomBytes(24).toString("base64url");
	await db.transaction(async (tx) => {
		await tx
			.delete(connectorLinkCode)
			.where(
				or(
					and(eq(connectorLinkCode.userId, userId), eq(connectorLinkCode.provider, provider)),
					lt(connectorLinkCode.expiresAt, new Date()),
				),
			);
		await tx.insert(connectorLinkCode).values({
			codeHash: hashCode(code),
			userId,
			provider,
			expiresAt: new Date(Date.now() + LINK_CODE_MINUTES * 60_000),
		});
	});
	return code;
}

/** Whose code it is. A code works once. */
export async function redeemLinkCode(db: Db, provider: ConnectorProvider, code: string) {
	const [used] = await db
		.delete(connectorLinkCode)
		.where(
			and(
				eq(connectorLinkCode.codeHash, hashCode(code)),
				eq(connectorLinkCode.provider, provider),
				gt(connectorLinkCode.expiresAt, new Date()),
			),
		)
		.returning({ userId: connectorLinkCode.userId });
	if (!used) return null;
	const [owner] = await db.select({ name: user.name }).from(user).where(eq(user.id, used.userId));
	return { userId: used.userId, name: owner?.name ?? "" };
}

/** The user's chat that owns this pull request, so a comment on it continues that chat. */
export async function findChatByPullRequest(db: Db, userId: string, projectId: string, number: number) {
	const [row] = await db
		.select({ id: chat.id })
		.from(chat)
		.where(and(eq(chat.userId, userId), eq(chat.projectId, projectId), eq(chat.pullRequestNumber, number)))
		.orderBy(desc(chat.updatedAt))
		.limit(1);
	return row?.id ?? null;
}

export async function findConnectedProject(db: Db, userId: string, installationId: number, githubRepoId: number) {
	const [row] = await db
		.select({ id: project.id, fullName: project.fullName })
		.from(project)
		.where(
			and(
				eq(project.userId, userId),
				eq(project.installationId, installationId),
				eq(project.githubRepoId, githubRepoId),
			),
		);
	return row ?? null;
}

/** The newest token for a workspace, to answer someone there who has not linked an account. */
export async function findWorkspaceToken(db: Db, provider: ConnectorProvider, workspaceId: string) {
	const [row] = await db
		.select({
			userId: connection.userId,
			provider: connection.provider,
			workspaceId: connection.workspaceId,
			tokenEncrypted: sql<string>`${connection.tokenEncrypted}`,
		})
		.from(connection)
		.where(
			and(
				eq(connection.provider, provider),
				eq(connection.workspaceId, workspaceId),
				isNotNull(connection.tokenEncrypted),
			),
		)
		.orderBy(desc(connection.updatedAt))
		.limit(1);
	return row ?? null;
}

export async function findConnection(db: Db, identity: Identity) {
	const [row] = await db
		.select({
			id: connection.id,
			userId: connection.userId,
			project: {
				id: project.id,
				fullName: project.fullName,
				defaultBranch: project.defaultBranch,
				installationId: project.installationId,
			},
		})
		.from(connection)
		.leftJoin(project, eq(connection.projectId, project.id))
		.where(sameIdentity(identity));
	return row ?? null;
}

type RequestKey = { connectionId: string; externalId: string };

const sameRequest = (key: RequestKey) =>
	and(eq(connectorRequest.connectionId, key.connectionId), eq(connectorRequest.externalId, key.externalId));

/** False when this request was already taken, so a repeated delivery starts nothing. */
export async function claimConnectorRequest(db: Db, key: RequestKey) {
	const rows = await db.insert(connectorRequest).values(key).onConflictDoNothing().returning();
	return rows.length > 0;
}

export async function attachConnectorRun(db: Db, key: RequestKey, runId: string, target?: string) {
	await db.update(connectorRequest).set({ runId, target }).where(sameRequest(key));
}

export type PendingReport = RequestKey & {
	provider: ConnectorProvider;
	userId: string;
	workspaceId: string;
	externalUserId: string;
	tokenEncrypted: string | null;
	target: string | null;
	installationId: number | null;
	chatId: string;
	chatTitle: string;
	projectName: string;
	status: "succeeded" | "failed" | "cancelled";
	error: string | null;
	answer: string | null;
	pullRequestUrl: string | null;
	pullRequestError: string | null;
};

/**
 * Takes the finished runs that still owe a reply, so two callers never send the same one.
 * Each take counts as an attempt.
 */
export async function claimReports(
	db: Db,
	options: { runId?: string; providers?: ConnectorProvider[]; limit?: number } = {},
) {
	if (options.providers?.length === 0) return [];
	const stale = new Date(Date.now() - CLAIM_MS);
	return db.transaction(async (tx): Promise<PendingReport[]> => {
		const due = await tx
			.select({
				connectionId: connectorRequest.connectionId,
				externalId: connectorRequest.externalId,
				provider: connection.provider,
				userId: connection.userId,
				workspaceId: connection.workspaceId,
				externalUserId: connection.externalUserId,
				tokenEncrypted: connection.tokenEncrypted,
				target: connectorRequest.target,
				installationId: project.installationId,
				chatId: chat.id,
				chatTitle: chat.title,
				projectName: project.fullName,
				status: sql<PendingReport["status"]>`${run.status}`,
				error: run.error,
				answer: sql<string | null>`(
					select m.content from message m where m.run_id = "run"."id" and m.role = 'assistant' limit 1
				)`,
				pullRequestUrl: chat.pullRequestUrl,
				pullRequestError: chat.pullRequestError,
			})
			.from(connectorRequest)
			.innerJoin(connection, eq(connectorRequest.connectionId, connection.id))
			.innerJoin(run, eq(connectorRequest.runId, run.id))
			.innerJoin(chat, eq(run.chatId, chat.id))
			.innerJoin(project, eq(chat.projectId, project.id))
			.where(
				and(
					inArray(run.status, ["succeeded", "failed", "cancelled"]),
					isNull(connectorRequest.reportedAt),
					lt(connectorRequest.attempts, MAX_REPORT_ATTEMPTS),
					or(isNull(connectorRequest.claimedAt), lt(connectorRequest.claimedAt, stale)),
					options.runId ? eq(run.id, options.runId) : undefined,
					options.providers ? inArray(connection.provider, options.providers) : undefined,
				),
			)
			.orderBy(asc(run.finishedAt))
			.limit(options.limit ?? 20)
			.for("update", { of: connectorRequest, skipLocked: true });

		for (const report of due) {
			await tx
				.update(connectorRequest)
				.set({ claimedAt: new Date(), attempts: sql`${connectorRequest.attempts} + 1` })
				.where(sameRequest(report));
		}
		return due;
	});
}

export async function finishReport(db: Db, key: RequestKey) {
	await db.update(connectorRequest).set({ reportedAt: new Date() }).where(sameRequest(key));
}

/** Lets the next sweep try again. */
export async function releaseReport(db: Db, key: RequestKey) {
	await db.update(connectorRequest).set({ claimedAt: null }).where(sameRequest(key));
}
