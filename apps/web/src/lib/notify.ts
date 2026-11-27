import type { FinishedRun, Inbox, Preferences } from "@nullfuse/db";

export type InboxResponse = Inbox & { preferences: Preferences };

/** Runs to announce: finished since the last look, and of a kind the user wants to hear about. */
export function newlyFinished(known: ReadonlySet<string>, inbox: InboxResponse): FinishedRun[] {
	const { notifyRunFinished, notifyRunFailed } = inbox.preferences;
	return inbox.finished.filter(
		(run) =>
			!known.has(run.runId) && (run.status === "failed" ? notifyRunFailed : notifyRunFinished),
	);
}

/** Changes when something the chat lists show has changed. */
export function inboxSignature(inbox: Inbox) {
	return [
		inbox.queued,
		inbox.running,
		inbox.needsReview,
		inbox.unread,
		inbox.finished[0]?.runId ?? "",
	].join("|");
}

export const notificationText = (run: FinishedRun) =>
	run.status === "failed" ? "Run failed" : "Run finished";
