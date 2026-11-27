import { MAX_MESSAGE_LENGTH } from "./chat";

export type IssueSummary = { number: number; title: string };

export type Issue = IssueSummary & {
	url: string;
	body: string;
	comments: { author: string; body: string }[];
};

const MAX_COMMENT_CHARS = 2000;

// Hidden comments do not show on GitHub, so the user could not know the agent was given them.
const visible = (text: string) => text.replace(/<!--[\s\S]*?(-->|$)/g, "").trim();

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);

/** The first message of a chat started from an issue. The user can edit it before sending. */
export function issueMessage(issue: Issue) {
	// The first line becomes the chat's and the pull request's title.
	const parts = [`Fix #${issue.number}: ${visible(issue.title)}`, issue.url];
	const body = visible(issue.body);
	if (body) parts.push(body);
	const comments = issue.comments
		.map((comment) => ({ ...comment, body: visible(comment.body) }))
		.filter((comment) => comment.body)
		.map((comment) => `${comment.author} commented:\n${clip(comment.body, MAX_COMMENT_CHARS)}`);
	return clip([...parts, ...comments].join("\n\n"), MAX_MESSAGE_LENGTH);
}
