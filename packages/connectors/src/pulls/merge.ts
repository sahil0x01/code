import {
	advanceMerge,
	type Db,
	endMerge,
	getPendingMerge,
	markChatMerged,
	queueMergeFix,
	takeMergesDue,
} from "@nullfuse/db";
import { MAX_MESSAGE_LENGTH } from "../limits";
import { errorStatus, failureReport, loadPull, mergePull, type PullClient, splitRepo } from "./pr-source";

const MAX_FIXES = 2;
const MAX_CHECKS = 3;
const GIVE_UP_MS = 2 * 60 * 60_000;
// Right after a push, GitHub may not show the new commit or its checks yet.
const SETTLE_MS = 2 * 60_000;

type Repo = { owner: string; repo: string };

export type MergeClient = PullClient & {
	pulls: {
		updateBranch(params: Repo & { pull_number: number; expected_head_sha: string }): Promise<unknown>;
	};
	repos: {
		getCommit(params: Repo & { ref: string }): Promise<{ data: { parents: { sha: string }[] } }>;
		compareCommitsWithBasehead(params: Repo & { basehead: string }): Promise<{ data: { status: string } }>;
	};
};

export type MergeDeps = {
	db: Db;
	github(installationId: number): Promise<MergeClient>;
	enqueue(run: { runId: string; chatId: string }): Promise<void>;
	now?: () => number;
};

export type MergeOutcome = "merged" | "waiting" | "updating" | "fixing" | "stopped" | "idle";

/** Whether `head` is only the approved commit with the base branch merged into it. */
async function isBaseUpdate(client: MergeClient, repo: Repo, head: string, approved: string, base: string) {
	const { data } = await client.repos.getCommit({ ...repo, ref: head });
	const [first, second, ...more] = data.parents;
	if (first?.sha !== approved || !second || more.length > 0) return false;
	const compared = await client.repos.compareCommitsWithBasehead({ ...repo, basehead: `${second.sha}...${base}` });
	return compared.data.status === "ahead" || compared.data.status === "identical";
}

/** A failure report cut to size, keeping its title and the end of the log, where the error is. */
function shorten(text: string, size: number) {
	return text.length <= size ? text : `${text.slice(0, 600)}\n...\n${text.slice(-(size - 605))}`;
}

/**
 * Takes a waiting merge one step further: merge, wait, update the branch, queue a fix or give
 * up. Only the commit the user approved is merged, so after a fix they are asked again.
 */
export async function stepMerge(deps: MergeDeps, chatId: string): Promise<MergeOutcome> {
	const merge = await getPendingMerge(deps.db, chatId);
	if (!merge) return "idle";
	const { since, fixRun, fullName, pullRequestNumber: number } = merge;
	const now = deps.now?.() ?? Date.now();
	const stop = async (note: string): Promise<MergeOutcome> => {
		await endMerge(deps.db, chatId, since, note);
		return "stopped";
	};
	// Before asking GitHub, so a merge it keeps refusing to describe still ends.
	if (now - since.getTime() > GIVE_UP_MS) return stop("Not merged: it was still not ready after two hours.");
	const client = await deps.github(merge.installationId);
	const pull = await loadPull(client, fullName, number);
	if (pull.state !== "ok") return "idle";

	const merged = async (): Promise<MergeOutcome> => {
		await markChatMerged(deps.db, merge.userId, chatId);
		await endMerge(deps.db, chatId, since, null);
		return "merged";
	};

	if (pull.status === "merged") return merged();
	if (pull.status === "closed") return stop("The pull request was closed.");
	if (fixRun && fixRun.status !== "succeeded") return stop("Not merged: the fix run did not finish.");

	const repo = splitRepo(fullName);
	const head = pull.headSha;
	let approved = merge.sha;
	if (head !== approved) {
		if (merge.updatedFrom === approved && (await isBaseUpdate(client, repo, head, approved, merge.baseBranch))) {
			approved = head;
			await advanceMerge(deps.db, chatId, since, { mergeSha: head, mergeUpdatedFrom: null });
		} else if (!fixRun) {
			return stop("Not merged: the branch changed after you clicked Merge. Review it, then merge again.");
		}
	}
	if (pull.status === "draft") return stop("Not merged: this pull request is a draft.");

	const settling = fixRun?.finishedAt ? now - fixRun.finishedAt.getTime() < SETTLE_MS : false;
	const fix = async (problem: string, content: string, updateBase = false): Promise<MergeOutcome> => {
		if (fixRun && head === merge.fixHead) {
			return settling ? "waiting" : stop(`Not merged: the agent made no change, and ${problem}.`);
		}
		if (merge.fixes >= MAX_FIXES) return stop(`Not merged: ${problem} after ${MAX_FIXES} fix runs.`);
		const queued = await queueMergeFix(deps.db, {
			chatId,
			since,
			fixes: merge.fixes,
			head,
			content,
			updateBase,
		});
		if (!queued.ok) {
			if (queued.reason === "model_removed") {
				return stop("Not merged: the chat's model was removed. Send a message with another one.");
			}
			return "waiting";
		}
		await deps.enqueue({ runId: queued.runId, chatId });
		return "fixing";
	};

	if (pull.conflicts) {
		return fix(
			"the branch still conflicts",
			`Before merging: update this branch with the latest ${merge.baseBranch} and resolve any conflicts.`,
			true,
		);
	}
	if (pull.checks.some((check) => check.state === "pending")) return "waiting";

	const failed = pull.checks.filter((check) => check.state === "failed");
	if (failed.length > 0) {
		const ids = failed
			.flatMap((check) => (check.fixable && check.checkRunId !== null ? [check.checkRunId] : []))
			.slice(0, MAX_CHECKS);
		if (ids.length === 0) {
			return stop(`Not merged: "${failed[0]?.name}" failed, and the agent can't fix that kind of failure.`);
		}
		const reports: string[] = [];
		for (const id of ids) {
			const report = await failureReport(client, fullName, number, id);
			if (report) reports.push(report);
		}
		if (reports.length === 0) return "waiting";
		const intro =
			"Before merging: fix the failed checks. Do not skip or weaken a test to make it pass. " +
			"Do not edit files in .github/workflows, because that change cannot be pushed.";
		const room = Math.floor((MAX_MESSAGE_LENGTH - intro.length) / reports.length) - 2;
		return fix("checks still fail", [intro, ...reports.map((report) => shorten(report, room))].join("\n\n"));
	}
	if (pull.checksUnavailable) return stop("Not merged: some checks can't be read.");
	if (settling && pull.checks.length === 0) return "waiting";

	if (head !== approved) {
		if (pull.checking) return "waiting";
		const state = pull.checks.length > 0 ? "checks pass" : "there are no checks";
		return stop(`The agent made changes and ${state}. Review them, then merge again.`);
	}
	if (pull.behind) {
		if (merge.updatedFrom === head) return "waiting";
		try {
			await client.pulls.updateBranch({ ...repo, pull_number: number, expected_head_sha: head });
		} catch (error) {
			if (![403, 422].includes(Number(errorStatus(error)))) throw error;
			return stop("Not merged: GitHub could not update the branch from its base.");
		}
		await advanceMerge(deps.db, chatId, since, { mergeUpdatedFrom: head });
		return "updating";
	}
	if (pull.checking) return "waiting";
	if (pull.blocker) return stop(`Not merged: ${pull.blocker}`);

	// The user may have cancelled or sent a message while GitHub was being read.
	if ((await getPendingMerge(deps.db, chatId))?.since.getTime() !== since.getTime()) return "idle";
	const result = await mergePull(client, fullName, number, approved);
	if (result.ok) return merged();
	// Someone else may have merged it first.
	const latest = await loadPull(client, fullName, number);
	return latest.state === "ok" && latest.status === "merged" ? merged() : stop(`Not merged: ${result.message}`);
}

/** One pass over the waiting merges. A failure in one never stops the others. */
export async function runMerges(deps: MergeDeps, options: { olderThanMs: number; limit: number; userId?: string }) {
	const due = await takeMergesDue(deps.db, options);
	const failed: { chatId: string; error: string }[] = [];
	for (const chatId of due) {
		try {
			await stepMerge(deps, chatId);
		} catch (error) {
			failed.push({ chatId, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { checked: due.length, failed };
}
