import "server-only";
import { getInstallationOctokit } from "@/lib/github-app";

export type RepoCheck = "ok" | "no_repo" | "no_branch";

function isStatus(error: unknown, ...statuses: number[]) {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof error.status === "number" &&
		statuses.includes(error.status)
	);
}

export async function checkRepo(
	installationId: number,
	fullName: string,
	branch?: string,
): Promise<RepoCheck> {
	const [owner, repo] = fullName.split("/");
	if (!owner || !repo) return "no_repo";

	const octokit = await getInstallationOctokit(installationId);

	try {
		await octokit.rest.repos.get({ owner, repo });
	} catch (error) {
		if (isStatus(error, 403, 404)) return "no_repo";
		throw error;
	}

	if (branch === undefined) return "ok";

	try {
		await octokit.rest.repos.getBranch({ owner, repo, branch });
	} catch (error) {
		if (isStatus(error, 404)) return "no_branch";
		throw error;
	}
	return "ok";
}

/** Whether this person can push to the repository right now. */
export async function canWrite(installationId: number, fullName: string, username: string) {
	const [owner = "", repo = ""] = fullName.split("/");
	const octokit = await getInstallationOctokit(installationId);
	try {
		const { data } = await octokit.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username });
		// GitHub reports "maintain" as write and "triage" as read.
		return data.permission === "admin" || data.permission === "write";
	} catch (error) {
		if (isStatus(error, 403, 404)) return false;
		throw error;
	}
}
