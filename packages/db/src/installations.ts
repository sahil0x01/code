import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./index";
import { account, installation } from "./schema";

export function listInstallations(db: Db, userId: string) {
	return db
		.select({
			id: installation.id,
			accountLogin: installation.accountLogin,
			accountType: installation.accountType,
			repositorySelection: installation.repositorySelection,
			suspendedAt: installation.suspendedAt,
		})
		.from(installation)
		.where(eq(installation.userId, userId))
		.orderBy(asc(installation.createdAt));
}

export async function findUserIdByGithubId(db: Db, githubId: number) {
	const [row] = await db
		.select({ userId: account.userId })
		.from(account)
		.where(
			and(
				eq(account.providerId, "github"),
				eq(account.accountId, String(githubId)),
			),
		);
	return row?.userId ?? null;
}

type NewInstallation = typeof installation.$inferInsert;

export async function upsertInstallation(db: Db, values: NewInstallation) {
	await db
		.insert(installation)
		.values(values)
		.onConflictDoUpdate({
			target: installation.id,
			set: {
				accountLogin: values.accountLogin,
				repositorySelection: values.repositorySelection,
				suspendedAt: values.suspendedAt ?? null,
				permissions: values.permissions ?? {},
				updatedAt: new Date(),
			},
		});
}

export async function getInstallationForUser(
	db: Db,
	userId: string,
	installationId: number,
) {
	const [row] = await db
		.select({ id: installation.id })
		.from(installation)
		.where(
			and(eq(installation.id, installationId), eq(installation.userId, userId)),
		);
	return row ?? null;
}

export async function deleteInstallation(db: Db, id: number) {
	await db.delete(installation).where(eq(installation.id, id));
}

export async function updateInstallation(
	db: Db,
	id: number,
	changes: Partial<
		Pick<
			typeof installation.$inferInsert,
			"suspendedAt" | "repositorySelection" | "permissions"
		>
	>,
) {
	await db
		.update(installation)
		.set({ ...changes, updatedAt: new Date() })
		.where(eq(installation.id, id));
}
