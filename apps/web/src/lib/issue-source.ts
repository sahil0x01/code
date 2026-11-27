import type { Issue, IssueSummary } from "./issue";
import { splitRepo } from "./pr-source";

type Repo = { owner: string; repo: string };

type GitHubIssue = {
	number: number;
	title: string;
	html_url: string;
	body?: string | null;
	/** Set when the "issue" is really a pull request. */
	pull_request?: unknown;
};

export type IssueClient = {
	issues: {
		listForRepo(
			params: Repo & { state: "open"; per_page: number; sort: "updated" },
		): Promise<{ data: GitHubIssue[] }>;
		get(params: Repo & { issue_number: number }): Promise<{ data: GitHubIssue }>;
		listComments(
			params: Repo & { issue_number: number; per_page: number },
		): Promise<{ data: { body?: string; user: { login: string } | null }[] }>;
	};
};

const MAX_COMMENTS = 20;

export async function listIssues(client: IssueClient, fullName: string): Promise<IssueSummary[]> {
	const { data } = await client.issues.listForRepo({
		...splitRepo(fullName),
		state: "open",
		sort: "updated",
		per_page: 100,
	});
	return data.filter((issue) => !issue.pull_request).map(({ number, title }) => ({ number, title }));
}

export async function loadIssue(client: IssueClient, fullName: string, number: number): Promise<Issue | null> {
	const repo = { ...splitRepo(fullName), issue_number: number };
	const [{ data }, comments] = await Promise.all([
		client.issues.get(repo),
		client.issues.listComments({ ...repo, per_page: MAX_COMMENTS }),
	]);
	if (data.pull_request) return null;
	return {
		number: data.number,
		title: data.title,
		url: data.html_url,
		body: data.body ?? "",
		comments: comments.data.map((comment) => ({
			author: comment.user?.login ?? "someone",
			body: comment.body ?? "",
		})),
	};
}
