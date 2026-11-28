import type { PullComment } from "./comments";
import { visibleText } from "./visible-text";
import { splitRepo } from "./pr-source";

type Repo = { owner: string; repo: string };
type Author = { login: string; type: string } | null;
type Found = {
	id: number;
	body?: string | null;
	user: Author;
	html_url: string;
	created_at?: string;
	state?: string;
};

export type CommentClient = {
	pulls: {
		listReviewComments(params: Repo & { pull_number: number; per_page: number }): Promise<{
			data: (Found & { path: string; line?: number | null; updated_at: string })[];
		}>;
		listReviews(params: Repo & { pull_number: number; per_page: number }): Promise<{
			data: (Found & { submitted_at?: string })[];
		}>;
	};
	issues: {
		listComments(params: Repo & { issue_number: number; per_page: number }): Promise<{
			data: (Found & { updated_at: string })[];
		}>;
	};
};

const MAX_COMMENTS = 30;

/** What people said on a pull request, newest first. Bots are left out. */
export async function listPullComments(
	client: CommentClient,
	fullName: string,
	number: number,
): Promise<PullComment[]> {
	const repo = splitRepo(fullName);
	const [lines, reviews, talk] = await Promise.all([
		client.pulls.listReviewComments({ ...repo, pull_number: number, per_page: 100 }),
		client.pulls.listReviews({ ...repo, pull_number: number, per_page: 100 }),
		client.issues.listComments({ ...repo, issue_number: number, per_page: 100 }),
	]);
	const comment = (kind: string, found: Found, where: string | null, updatedAt: string) =>
		found.user?.type === "Bot" || !visibleText(found.body ?? "")
			? []
			: [
					{
						key: `${kind}:${found.id}`,
						author: found.user?.login ?? "someone",
						body: visibleText(found.body ?? ""),
						where,
						url: found.html_url,
						updatedAt,
						createdAt: found.created_at ?? updatedAt,
						approval: found.state === "APPROVED",
					},
				];

	return [
		...lines.data.flatMap((c) => comment("line", c, c.line ? `${c.path}:${c.line}` : c.path, c.updated_at)),
		...reviews.data.flatMap((c) => comment("review", c, null, c.submitted_at ?? "")),
		...talk.data.flatMap((c) => comment("talk", c, null, c.updated_at)),
	]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, MAX_COMMENTS);
}
