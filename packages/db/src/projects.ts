import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./index";
import { project, projectEnvVar } from "./schema";

export function listProjects(db: Db, userId: string) {
	return db
		.select({
			id: project.id,
			installationId: project.installationId,
			githubRepoId: project.githubRepoId,
			fullName: project.fullName,
			defaultBranch: project.defaultBranch,
			isPrivate: project.isPrivate,
		})
		.from(project)
		.where(eq(project.userId, userId))
		.orderBy(asc(project.fullName));
}

export type ProjectInput = {
	githubRepoId: number;
	fullName: string;
	defaultBranch: string;
	isPrivate: boolean;
};

export async function upsertProjects(
	db: Db,
	userId: string,
	installationId: number,
	repos: ProjectInput[],
) {
	if (repos.length === 0) return;

	await db
		.insert(project)
		.values(repos.map((repo) => ({ userId, installationId, ...repo })))
		.onConflictDoUpdate({
			target: [project.userId, project.githubRepoId],
			set: {
				installationId: sql`excluded.installation_id`,
				fullName: sql`excluded.full_name`,
				defaultBranch: sql`excluded.default_branch`,
				isPrivate: sql`excluded.is_private`,
				updatedAt: new Date(),
			},
		});
}

export async function disconnectProjects(
	db: Db,
	installationId: number,
	repoIds: number[],
) {
	if (repoIds.length === 0) return;

	await db
		.update(project)
		.set({ installationId: null, updatedAt: new Date() })
		.where(
			and(
				eq(project.installationId, installationId),
				inArray(project.githubRepoId, repoIds),
			),
		);
}

export async function refreshProject(
	db: Db,
	installationId: number,
	repo: ProjectInput,
) {
	await db
		.update(project)
		.set({
			fullName: repo.fullName,
			defaultBranch: repo.defaultBranch,
			isPrivate: repo.isPrivate,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(project.installationId, installationId),
				eq(project.githubRepoId, repo.githubRepoId),
			),
		);
}

export async function getProjectForUser(
	db: Db,
	userId: string,
	projectId: string,
) {
	const [row] = await db
		.select({
			id: project.id,
			fullName: project.fullName,
			defaultBranch: project.defaultBranch,
			isPrivate: project.isPrivate,
			installationId: project.installationId,
			installCommand: project.installCommand,
			testCommand: project.testCommand,
		})
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.userId, userId)));
	return row ?? null;
}

export async function updateProjectSetup(
	db: Db,
	projectId: string,
	setup: { installCommand: string | null; testCommand: string | null },
) {
	await db
		.update(project)
		.set({ ...setup, updatedAt: new Date() })
		.where(eq(project.id, projectId));
}

export function listEnvVars(db: Db, projectId: string) {
	return db
		.select({ name: projectEnvVar.name, updatedAt: projectEnvVar.updatedAt })
		.from(projectEnvVar)
		.where(eq(projectEnvVar.projectId, projectId))
		.orderBy(asc(projectEnvVar.name));
}

export async function upsertEnvVar(
	db: Db,
	projectId: string,
	name: string,
	valueEncrypted: string,
) {
	await db
		.insert(projectEnvVar)
		.values({ projectId, name, valueEncrypted })
		.onConflictDoUpdate({
			target: [projectEnvVar.projectId, projectEnvVar.name],
			set: { valueEncrypted, updatedAt: new Date() },
		});
}

export async function deleteEnvVar(db: Db, projectId: string, name: string) {
	await db
		.delete(projectEnvVar)
		.where(
			and(eq(projectEnvVar.projectId, projectId), eq(projectEnvVar.name, name)),
		);
}
