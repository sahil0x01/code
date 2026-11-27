import { z } from "zod";

const person = z.object({ id: z.number(), login: z.string(), type: z.string() });

const issueSchema = z.object({
	number: z.number(),
	title: z.string(),
	body: z.string().nullish(),
	html_url: z.url(),
	user: person,
	pull_request: z.object({}).optional(),
});

const shared = {
	action: z.string(),
	issue: issueSchema,
	repository: z.object({ id: z.number(), full_name: z.string() }),
	installation: z.object({ id: z.number() }).optional(),
};

const commentEvent = z.object({
	...shared,
	comment: z.object({ id: z.number(), body: z.string(), user: person }),
});

const issueEvent = z.object(shared);

const hidden = /<!--[\s\S]*?(-->|$)/g;
// Quoting or showing a command does not give it.
const quoted = /```[\s\S]*?(```|$)|`[^`\n]*`|^\s*>.*$/gm;

/** What the comment asks for, or null when it does not address the app. */
export function mentionTask(body: string, slug: string) {
	const visible = body.replace(hidden, "");
	const mention = new RegExp(`(^|\\s)@${slug.replace(/[^\w-]/g, "")}(?:\\[bot\\])?(?![\\w-])|^/prefill(?=\\s|$)`, "im");
	if (!mention.test(visible.replace(quoted, ""))) return null;
	return visible.replace(new RegExp(mention.source, "gim"), "$1").trim();
}

type Written = {
	id: string;
	body: string;
	user: z.infer<typeof person>;
};

function mention(
	source: "comment" | "issue",
	event: z.infer<typeof commentEvent> | z.infer<typeof issueEvent>,
	written: Written,
	slug: string,
) {
	const { issue, repository, installation } = event;
	// Bots are ignored, so the app's own replies can never start another run.
	if (!installation || written.user.type !== "User") return null;
	const task = mentionTask(written.body, slug);
	if (task === null) return null;
	return {
		source,
		id: written.id,
		task,
		sender: { id: written.user.id, login: written.user.login },
		issue: {
			number: issue.number,
			url: issue.html_url,
			isPullRequest: issue.pull_request !== undefined,
			author: issue.user.login,
			title: issue.title.replace(hidden, "").trim(),
			body: (issue.body ?? "").replace(hidden, "").trim(),
		},
		repository: { id: repository.id, fullName: repository.full_name },
		installationId: installation.id,
	};
}

export type GitHubMention = NonNullable<ReturnType<typeof mention>>;

/** Null unless a person wrote a new comment addressing the app. Their access is checked later. */
export function parseGitHubComment(payload: unknown, slug: string) {
	const parsed = commentEvent.safeParse(payload);
	if (!parsed.success || parsed.data.action !== "created") return null;
	const { id, body, user } = parsed.data.comment;
	return mention("comment", parsed.data, { id: String(id), body, user }, slug);
}

/** Null unless a person opened an issue whose description addresses the app. */
export function parseGitHubIssue(payload: unknown, slug: string) {
	const parsed = issueEvent.safeParse(payload);
	if (!parsed.success || parsed.data.action !== "opened") return null;
	const { number, body, user } = parsed.data.issue;
	return mention("issue", parsed.data, { id: `issue-${number}`, body: body ?? "", user }, slug);
}

/**
 * Whether the person may give tasks, and whether the issue's text may reach the agent: both
 * need write access, since nobody reads the text first. A check that fails means no.
 */
export async function mentionAccess(
	mention: GitHubMention,
	canWrite: (login: string) => Promise<boolean>,
) {
	const check = (login: string) => canWrite(login).catch(() => false);
	if (!(await check(mention.sender.login))) return { allowed: false, readable: false };
	const { author } = mention.issue;
	return { allowed: true, readable: author === mention.sender.login || (await check(author)) };
}

/**
 * The first message of a chat started from an issue. Null when there is nothing to do:
 * the mention gives no task and the issue's text may not be used.
 */
export function issueTask({ source, issue, task, sender }: GitHubMention, readable: boolean) {
	const asked = `Asked by ${sender.login} on ${issue.url}`;
	if (!readable) {
		// In a description, the task itself is the text that may not be used.
		if (!task || source === "issue") return null;
		const why = "The issue's text was left out, because its author can't write to the repository.";
		return [task, asked, why].join("\n\n");
	}
	const title = `Fix #${issue.number}: ${issue.title}`;
	// The mention was in the description, so the task is the description.
	if (source === "issue") {
		// A command such as /plan only counts at the start.
		const parts = task.startsWith("/") ? [task, title] : [title, task];
		return [...parts, asked].filter(Boolean).join("\n\n");
	}
	const parts = [task || title, asked, `The issue, "${issue.title}", is background.`];
	if (issue.body) parts.push(issue.body);
	return parts.join("\n\n");
}

/** Stops the agent's text from notifying people or closing issues when it is posted. */
export function escapeGitHub(text: string) {
	return text.replace(/@(?=[\w-])/g, "@\u200b").replace(/<!--/g, "&lt;!--");
}
