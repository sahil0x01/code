import { eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
	account,
	installation,
	project,
	projectEnvVar,
	session,
	user,
	userPreference,
	waitlist,
} from "./schema";

export async function exportAccountData(db: Db, userId: string) {
	const [profile] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			createdAt: user.createdAt,
		})
		.from(user)
		.where(eq(user.id, userId));

	if (!profile) return null;

	const logins = await db
		.select({
			provider: account.providerId,
			providerAccountId: account.accountId,
			scope: account.scope,
			createdAt: account.createdAt,
		})
		.from(account)
		.where(eq(account.userId, userId));

	const sessions = await db
		.select({
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
		})
		.from(session)
		.where(eq(session.userId, userId));

	const waitlistEntries = await db
		.select({ email: waitlist.email, createdAt: waitlist.createdAt })
		.from(waitlist)
		.where(eq(waitlist.email, profile.email));

	const [preferences] = await db
		.select({
			notifyRunFinished: userPreference.notifyRunFinished,
			notifyRunFailed: userPreference.notifyRunFailed,
			updatedAt: userPreference.updatedAt,
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId));

	const installations = await db
		.select({
			githubInstallationId: installation.id,
			accountLogin: installation.accountLogin,
			accountType: installation.accountType,
			repositorySelection: installation.repositorySelection,
			suspendedAt: installation.suspendedAt,
			createdAt: installation.createdAt,
		})
		.from(installation)
		.where(eq(installation.userId, userId));

	const projects = await db
		.select({
			id: project.id,
			githubRepoId: project.githubRepoId,
			fullName: project.fullName,
			defaultBranch: project.defaultBranch,
			isPrivate: project.isPrivate,
			connected: sql<boolean>`${project.installationId} is not null`,
			createdAt: project.createdAt,
			installCommand: project.installCommand,
			testCommand: project.testCommand,
		})
		.from(project)
		.where(eq(project.userId, userId));

	const envVarNames = await db
		.select({
			projectId: projectEnvVar.projectId,
			name: projectEnvVar.name,
			updatedAt: projectEnvVar.updatedAt,
		})
		.from(projectEnvVar)
		.innerJoin(project, eq(project.id, projectEnvVar.projectId))
		.where(eq(project.userId, userId));

	return {
		exportedAt: new Date().toISOString(),
		profile,
		logins,
		sessions,
		waitlist: waitlistEntries,
		preferences: preferences ?? null,
		installations,
		projects,
		envVarNames,
	};
}

export async function deleteWaitlistEntry(db: Db, email: string) {
	await db.delete(waitlist).where(eq(waitlist.email, email));
}
