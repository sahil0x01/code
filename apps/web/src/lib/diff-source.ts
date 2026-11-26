import type { Diff, DiffFile, DiffResponse } from "./diff";

/** GitHub stops listing a comparison's files here. */
export const MAX_DIFF_FILES = 300;

type GitHubFile = {
	filename: string;
	previous_filename?: string;
	status: string;
	additions: number;
	deletions: number;
	patch?: string;
};

type Repo = { owner: string; repo: string };

export type DiffClient = {
	repos: {
		getBranch(params: Repo & { branch: string }): Promise<{ data: { commit: { sha: string } } }>;
		compareCommitsWithBasehead(
			params: Repo & { basehead: string },
		): Promise<{ data: { files?: GitHubFile[] } }>;
	};
	pulls: {
		get(params: Repo & { pull_number: number }): Promise<{
			data: { merged: boolean; head: { sha: string } };
		}>;
		listFiles(
			params: Repo & { pull_number: number; per_page: number; page: number },
		): Promise<{ data: GitHubFile[] }>;
	};
};

export type DiffRequest = {
	fullName: string;
	baseBranch: string;
	workingBranch: string;
	pullNumber: number | null;
	/** The commit the browser already shows, to skip loading it again. */
	knownHead?: string;
};

function isNotFound(error: unknown) {
	return typeof error === "object" && error !== null && "status" in error && error.status === 404;
}

function toFile(file: GitHubFile): DiffFile {
	return {
		path: file.filename,
		previousPath: file.previous_filename,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
		patch: file.patch ?? null,
	};
}

async function pullFiles(client: DiffClient, repo: Repo, pullNumber: number) {
	const files: GitHubFile[] = [];
	for (let page = 1; files.length < MAX_DIFF_FILES; page++) {
		const { data } = await client.pulls.listFiles({
			...repo,
			pull_number: pullNumber,
			per_page: 100,
			page,
		});
		files.push(...data);
		if (data.length < 100) break;
	}
	return files;
}

export async function loadDiff(client: DiffClient, request: DiffRequest): Promise<DiffResponse> {
	const [owner = "", name = ""] = request.fullName.split("/");
	const repo = { owner, repo: name };
	const { pullNumber, knownHead } = request;

	const result = (headSha: string, files: GitHubFile[], url: string): Diff => ({
		state: "ok",
		headSha,
		files: files.map(toFile),
		truncated: files.length >= MAX_DIFF_FILES,
		url,
	});
	const web = `https://github.com/${request.fullName}`;
	const pullUrl = `${web}/pull/${pullNumber}/files`;

	let head: string;
	try {
		const branch = await client.repos.getBranch({ ...repo, branch: request.workingBranch });
		head = branch.data.commit.sha;
	} catch (error) {
		if (!isNotFound(error)) throw error;
		if (pullNumber === null) return { state: "not_pushed" };
		const pull = await client.pulls.get({ ...repo, pull_number: pullNumber });
		if (pull.data.head.sha === knownHead) return { state: "unchanged" };
		return result(pull.data.head.sha, await pullFiles(client, repo, pullNumber), pullUrl);
	}
	if (head === knownHead) return { state: "unchanged" };

	const compared = await client.repos.compareCommitsWithBasehead({
		...repo,
		basehead: `${request.baseBranch}...${head}`,
	});
	const files = compared.data.files ?? [];

	// After a merge the branches no longer differ, but the PR still lists what changed.
	if (files.length === 0 && pullNumber !== null) {
		const pull = await client.pulls.get({ ...repo, pull_number: pullNumber });
		if (pull.data.merged && pull.data.head.sha === head) {
			return result(head, await pullFiles(client, repo, pullNumber), pullUrl);
		}
	}

	const range = `${encodeURIComponent(request.baseBranch)}...${head}`;
	return result(head, files, `${web}/compare/${range}`);
}
