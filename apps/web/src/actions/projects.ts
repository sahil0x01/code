"use server";

import { getInstallationForUser, upsertProjects } from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { listInstallationRepos } from "@/server/github-repos";
import { requireSession } from "@/server/session";

export type ImportState =
	| { status: "idle" }
	| { status: "error"; message: string };

const inputSchema = z.object({
	installationId: z.coerce.number().int().positive(),
	repoIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

export async function importProjects(
	_previous: ImportState,
	formData: FormData,
): Promise<ImportState> {
	const { user } = await requireSession();

	const input = inputSchema.safeParse({
		installationId: formData.get("installationId"),
		repoIds: formData.getAll("repoId"),
	});
	if (!input.success) {
		return { status: "error", message: "Pick at least one repository." };
	}

	const owned = await getInstallationForUser(
		db,
		user.id,
		input.data.installationId,
	);
	if (!owned) {
		return {
			status: "error",
			message: "That GitHub account is not connected.",
		};
	}

	try {
		const available = await listInstallationRepos(owned.id);
		const wanted = new Set(input.data.repoIds);
		const chosen = available.filter((repo) => wanted.has(repo.id));

		if (chosen.length === 0) {
			return {
				status: "error",
				message: "Those repositories are not available to the app.",
			};
		}

		await upsertProjects(
			db,
			user.id,
			owned.id,
			chosen.map((repo) => ({
				githubRepoId: repo.id,
				fullName: repo.fullName,
				defaultBranch: repo.defaultBranch,
				isPrivate: repo.isPrivate,
			})),
		);
	} catch (error) {
		console.error("import projects failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard/projects");
	redirect("/dashboard/projects");
}
