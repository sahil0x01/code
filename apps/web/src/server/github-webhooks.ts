import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
	deleteInstallation,
	disconnectProjects,
	findUserIdByGithubId,
	refreshProject,
	updateInstallation,
	upsertInstallation,
} from "@nullfuse/db";
import { z } from "zod";
import { env } from "@/env";
import { db } from "@/server/db";

export function verifySignature(body: string, header: string | null) {
	if (!header?.startsWith("sha256=")) return false;
	const expected = createHmac("sha256", env.GITHUB_APP_WEBHOOK_SECRET)
		.update(body)
		.digest();
	const given = Buffer.from(header.slice("sha256=".length), "hex");
	return given.length === expected.length && timingSafeEqual(given, expected);
}

const installationEvent = z.object({
	action: z.string(),
	installation: z.object({
		id: z.number(),
		account: z.object({
			id: z.number(),
			login: z.string(),
			type: z.enum(["User", "Organization"]),
		}),
		repository_selection: z.enum(["all", "selected"]),
		permissions: z.record(z.string(), z.string()),
		suspended_at: z.string().nullable(),
	}),
	sender: z.object({ id: z.number() }),
});

export async function handleInstallation(payload: unknown) {
	const event = installationEvent.parse(payload);
	const inst = event.installation;

	switch (event.action) {
		case "created": {
			const userId = await findUserIdByGithubId(db, event.sender.id);
			if (!userId) {
				console.warn("installation.created: no matching user, ignored");
				return;
			}
			await upsertInstallation(db, {
				id: inst.id,
				userId,
				accountId: inst.account.id,
				accountLogin: inst.account.login,
				accountType: inst.account.type,
				repositorySelection: inst.repository_selection,
				permissions: inst.permissions,
			});
			return;
		}
		case "deleted":
			await deleteInstallation(db, inst.id);
			return;
		case "suspend":
		case "unsuspend":
			await updateInstallation(db, inst.id, {
				suspendedAt: inst.suspended_at ? new Date(inst.suspended_at) : null,
			});
			return;
		case "new_permissions_accepted":
			await updateInstallation(db, inst.id, { permissions: inst.permissions });
			return;
		default:
			return;
	}
}

const repositoriesEvent = z.object({
	action: z.string(),
	installation: z.object({
		id: z.number(),
		repository_selection: z.enum(["all", "selected"]),
	}),
	repositories_removed: z.array(z.object({ id: z.number() })),
});

export async function handleInstallationRepositories(payload: unknown) {
	const event = repositoriesEvent.parse(payload);

	await updateInstallation(db, event.installation.id, {
		repositorySelection: event.installation.repository_selection,
	});
	await disconnectProjects(
		db,
		event.installation.id,
		event.repositories_removed.map((repo) => repo.id),
	);
}

const repositoryEvent = z.object({
	action: z.string(),
	repository: z.object({
		id: z.number(),
		full_name: z.string(),
		default_branch: z.string(),
		private: z.boolean(),
	}),
	installation: z.object({ id: z.number() }).optional(),
});

const refreshActions = new Set([
	"renamed",
	"edited",
	"privatized",
	"publicized",
	"transferred",
]);

export async function handleRepository(payload: unknown) {
	const event = repositoryEvent.parse(payload);
	if (!event.installation) return;

	const installationId = event.installation.id;
	const repo = event.repository;

	if (event.action === "deleted") {
		await disconnectProjects(db, installationId, [repo.id]);
	} else if (refreshActions.has(event.action)) {
		await refreshProject(db, installationId, {
			githubRepoId: repo.id,
			fullName: repo.full_name,
			defaultBranch: repo.default_branch,
			isPrivate: repo.private,
		});
	}
}
