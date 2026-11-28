import { type AutoFixChat, type Db, listAutoFixSeen, markAutoFixSeen, markChatMerged, queueAutoFixRun, takeAutoFixDue, turnOffAutoFix } from "@nullfuse/db";
import { MAX_MESSAGE_LENGTH } from "../limits";
import { type CommentClient, listPullComments } from "./comment-source";
import { commentsMessage } from "./comments";
import { failureReport, loadPull, type PullClient } from "./pr-source";

const MAX_CHECKS = 3;
const MAX_COMMENTS = 5;
const MAX_COMMENT_CHARS = MAX_MESSAGE_LENGTH / 2;
// A reviewer often writes several comments, so wait until they stop.
const QUIET_MS = 2 * 60_000;

export type AutoFixDeps = {
	db: Db;
	github(installationId: number): Promise<{
		client: PullClient & CommentClient;
		canWrite(fullName: string, login: string): Promise<boolean>;
	}>;
	enqueue(run: { runId: string; chatId: string }): Promise<void>;
	maxRuns: number;
	maxCost: number;
	now?: () => number;
};

export type AutoFixOutcome = "queued" | "nothing" | "waiting" | "ended" | "blocked";

/** A failure report cut to size, keeping its title and the end of the log, where the error is. */
function shorten(text: string, size: number) {
	return text.length <= size ? text : `${text.slice(0, 600)}\n...\n${text.slice(-(size - 605))}`;
}

/** Looks at one chat's pull request and queues at most one run for what needs fixing. */
export async function autoFixChat(deps: AutoFixDeps, chat: AutoFixChat): Promise<AutoFixOutcome> {
	const { client, canWrite } = await deps.github(chat.installationId);
	const pull = await loadPull(client, chat.fullName, chat.pullRequestNumber);
	if (pull.state !== "ok") return "nothing";
	if (pull.status === "merged" || pull.status === "closed") {
		if (pull.status === "merged") await markChatMerged(deps.db, chat.userId, chat.chatId);
		await turnOffAutoFix(deps.db, chat.chatId, null);
		return "ended";
	}

	const seen = await listAutoFixSeen(deps.db, chat.chatId);
	const send = async (keys: string[], content: string, updateBase = false): Promise<AutoFixOutcome> => {
		const queued = await queueAutoFixRun(deps.db, {
			chatId: chat.chatId,
			since: chat.since,
			keys,
			content,
			updateBase,
			maxRuns: deps.maxRuns,
			maxCost: deps.maxCost,
		});
		if (!queued.ok) return "blocked";
		await deps.enqueue({ runId: queued.runId, chatId: queued.chatId });
		return "queued";
	};

	const conflict = `conflict:${pull.headSha}:${pull.baseSha}`;
	if (pull.conflicts && !seen.has(conflict)) {
		return send(
			[conflict],
			`Auto-fix: update this branch with the latest ${chat.baseBranch} and resolve any conflicts.`,
			true,
		);
	}
	// One run for everything that failed costs less than one for each check as it finishes.
	if (pull.checks.some((check) => check.state === "pending")) return "waiting";

	const unread = (await listPullComments(client, chat.fullName, chat.pullRequestNumber)).filter(
		(comment) =>
			!comment.approval && !seen.has(comment.key) && Date.parse(comment.createdAt) >= chat.since.getTime(),
	);
	const now = deps.now?.() ?? Date.now();
	if (unread.some((comment) => now - Date.parse(comment.updatedAt) < QUIET_MS)) return "waiting";

	// Only people who could push the change themselves may start a run.
	const writers = new Map<string, boolean>();
	for (const { author } of unread) {
		if (!writers.has(author)) writers.set(author, await canWrite(chat.fullName, author));
	}
	await markAutoFixSeen(
		deps.db,
		chat.chatId,
		unread.filter((comment) => !writers.get(comment.author)).map((comment) => comment.key),
	);
	// Oldest first. One that does not fit is left for the next run, not cut off.
	const comments = unread
		.filter((comment) => writers.get(comment.author))
		.reverse()
		.slice(0, MAX_COMMENTS);
	while (comments.length > 1 && commentsMessage(comments).length > MAX_COMMENT_CHARS) comments.pop();

	const failed = pull.checks
		.flatMap((check) => (check.fixable && check.checkRunId !== null ? [check.checkRunId] : []))
		.filter((id) => !seen.has(`check:${id}`))
		.slice(0, MAX_CHECKS);
	const reports: { key: string; text: string }[] = [];
	for (const id of failed) {
		const text = await failureReport(client, chat.fullName, chat.pullRequestNumber, id);
		if (text) reports.push({ key: `check:${id}`, text });
	}
	if (comments.length === 0 && reports.length === 0) return "nothing";

	const parts = ["Auto-fix: deal with what follows on the pull request."];
	if (comments.length > 0) parts.push(commentsMessage(comments));
	const room = MAX_MESSAGE_LENGTH - parts.join("\n\n").length;
	for (const report of reports) parts.push(shorten(report.text, Math.floor(room / reports.length) - 2));

	return send(
		[...comments.map((comment) => comment.key), ...reports.map((report) => report.key)],
		parts.join("\n\n"),
	);
}

/** One pass over the chats that are due. A failure in one never stops the others. */
export async function runAutoFix(deps: AutoFixDeps, options: { olderThanMs: number; limit: number; userId?: string }) {
	const due = await takeAutoFixDue(deps.db, options);
	let queued = 0;
	const failed: { chatId: string; error: string }[] = [];
	for (const chat of due) {
		try {
			if ((await autoFixChat(deps, chat)) === "queued") queued += 1;
		} catch (error) {
			failed.push({ chatId: chat.chatId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { checked: due.length, queued, failed };
}
