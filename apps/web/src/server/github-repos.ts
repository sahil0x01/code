import "server-only";
import { getInstallationOctokit } from "@/lib/github-app";

export type InstallationRepo = {
	id: number;
	fullName: string;
	defaultBranch: string;
	isPrivate: boolean;
};

export async function listInstallationRepos(
	installationId: number,
): Promise<InstallationRepo[]> {
	const octokit = await getInstallationOctokit(installationId);
	const repos = await octokit.paginate(
		octokit.rest.apps.listReposAccessibleToInstallation,
		{ per_page: 100 },
	);

	return repos
		.filter((repo) => !repo.archived)
		.map((repo) => ({
			id: repo.id,
			fullName: repo.full_name,
			defaultBranch: repo.default_branch,
			isPrivate: repo.private,
		}))
		.sort((a, b) => a.fullName.localeCompare(b.fullName));
}
