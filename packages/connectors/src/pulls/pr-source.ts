import { MAX_MESSAGE_LENGTH } from "../limits";
import type { Check, CheckState, PullStatus } from "./pr";

type Repo = { owner: string; repo: string };
type Pull = Repo & { pull_number: number };

type GitHubPull = {
	html_url: string;
	state: string;
	merged: boolean;
	draft?: boolean;
	mergeable: boolean | null;
	mergeable_state: string;
	head: { sha: string };
	base: { sha: string };
};

type GitHubCheckRun = {
	id: number;
	name: string;
	status: string;
	conclusion: string | null;
	html_url: string | null;
	head_sha: string;
	output: { title: string | null; summary: string | null };
};

export type PullClient = {
	pulls: {
		get(params: Pull): Promise<{ data: GitHubPull }>;
		merge(
			params: Pull & { sha: string; merge_method: "merge" | "squash" | "rebase" },
		): Promise<unknown>;
	};
	repos: {
		get(params: Repo): Promise<{
			data: { allow_squash_merge?: boolean; allow_merge_commit?: boolean };
		}>;
		listDeployments(params: Repo & { sha: string; per_page: number }): Promise<{
			data: { id: number; environment: string; production_environment?: boolean }[];
		}>;
		listDeploymentStatuses(params: Repo & { deployment_id: number; per_page: number }): Promise<{
			data: { state: string; environment_url?: string }[];
		}>;
		getCombinedStatusForRef(params: Repo & { ref: string; per_page: number }): Promise<{
			data: {
				statuses: { context: string; state: string; target_url: string | null }[];
			};
		}>;
	};
	checks: {
		listForRef(
			params: Repo & { ref: string; per_page: number },
		): Promise<{ data: { check_runs: GitHubCheckRun[] } }>;
		get(params: Repo & { check_run_id: number }): Promise<{ data: GitHubCheckRun }>;
		listAnnotations(params: Repo & { check_run_id: number; per_page: number }): Promise<{
			data: { path: string; start_line: number; message: string | null; annotation_level?: string | null }[];
		}>;
	};
	actions: {
		downloadJobLogsForWorkflowRun(params: Repo & { job_id: number }): Promise<{ data: unknown }>;
	};
};

export function splitRepo(fullName: string): Repo {
	const [owner = "", repo = ""] = fullName.split("/");
	return { owner, repo };
}

export function errorStatus(error: unknown) {
	return typeof error === "object" && error !== null && "status" in error
		? error.status
		: undefined;
}

const FAILED = ["failure", "timed_out", "cancelled", "action_required", "startup_failure"];

function runState(run: Pick<GitHubCheckRun, "status" | "conclusion">): CheckState {
	if (run.status !== "completed") return "pending";
	if (run.conclusion === "success") return "passed";
	return FAILED.includes(run.conclusion ?? "") ? "failed" : "skipped";
}

function statusState(state: string): CheckState {
	if (state === "success") return "passed";
	return state === "pending" ? "pending" : "failed";
}

/** Null when the app is not allowed to read this kind of check. */
async function allowed<T>(request: Promise<T>) {
	try {
		return await request;
	} catch (error) {
		if (errorStatus(error) === 403) return null;
		throw error;
	}
}

const MAX_DEPLOYMENTS = 5;

/** Preview deployments of this commit that another service (Vercel, Netlify) already made. */
async function deploymentsFor(client: PullClient, repo: Repo, sha: string) {
	const listed = await allowed(client.repos.listDeployments({ ...repo, sha, per_page: 30 }));
	const previews = (listed?.data ?? [])
		.filter((deployment) => !deployment.production_environment)
		.slice(0, MAX_DEPLOYMENTS);
	const found = await Promise.all(
		previews.map(async ({ id, environment }) => {
			const statuses = await allowed(
				client.repos.listDeploymentStatuses({ ...repo, deployment_id: id, per_page: 1 }),
			);
			// Newest first.
			const latest = statuses?.data[0];
			const url = latest?.environment_url;
			return latest?.state === "success" && url?.startsWith("https://")
				? { id, name: environment, url }
				: null;
		}),
	);
	return found.filter((deployment) => deployment !== null);
}

function blockerFor(pull: GitHubPull) {
	if (pull.draft) return "This pull request is a draft.";
	if (pull.mergeable_state === "dirty") return "The branch conflicts with the base branch.";
	if (pull.mergeable === null) return "GitHub is still checking whether this can be merged.";
	if (pull.mergeable_state === "blocked") {
		return "A branch rule blocks merging, such as a required review or check.";
	}
	if (pull.mergeable_state === "behind") return "The branch is behind the base branch.";
	return pull.mergeable ? null : "GitHub says this can't be merged.";
}

export async function loadPull(
	client: PullClient,
	fullName: string,
	number: number,
): Promise<PullStatus> {
	const repo = splitRepo(fullName);
	const { data: pull } = await client.pulls.get({ ...repo, pull_number: number });
	const ref = pull.head.sha;

	const [runs, statuses, deployments] = await Promise.all([
		allowed(client.checks.listForRef({ ...repo, ref, per_page: 100 })),
		allowed(client.repos.getCombinedStatusForRef({ ...repo, ref, per_page: 100 })),
		// Only extra links, so a failure here must not hide the pull request.
		deploymentsFor(client, repo, ref).catch(() => []),
	]);

	const checks: Check[] = [
		...(runs?.data.check_runs ?? []).map((run) => ({
			key: `run:${run.id}`,
			checkRunId: run.id,
			name: run.name,
			state: runState(run),
			url: run.html_url,
			fixable: run.status === "completed" && ["failure", "timed_out"].includes(run.conclusion ?? ""),
		})),
		...(statuses?.data.statuses ?? []).map((status) => ({
			key: `status:${status.context}`,
			checkRunId: null,
			name: status.context,
			state: statusState(status.state),
			url: status.target_url,
			fixable: false,
		})),
	];

	const status = pull.merged
		? "merged"
		: pull.state === "closed"
			? "closed"
			: pull.draft
				? "draft"
				: "open";

	return {
		state: "ok",
		number,
		url: pull.html_url,
		headSha: ref,
		baseSha: pull.base.sha,
		conflicts: pull.mergeable_state === "dirty",
		behind: pull.mergeable_state === "behind",
		checking: pull.mergeable === null,
		status,
		blocker: status === "open" || status === "draft" ? blockerFor(pull) : null,
		checks,
		checksUnavailable: runs === null || statuses === null,
		deployments,
	};
}

export type MergeResult = { ok: true } | { ok: false; message: string };

/** Merges only the commit the user was looking at; GitHub still applies branch rules. */
export async function mergePull(
	client: PullClient,
	fullName: string,
	number: number,
	sha: string,
): Promise<MergeResult> {
	const repo = splitRepo(fullName);
	const { data } = await client.repos.get(repo);
	const merge_method =
		data.allow_squash_merge !== false
			? "squash"
			: data.allow_merge_commit !== false
				? "merge"
				: "rebase";

	try {
		await client.pulls.merge({ ...repo, pull_number: number, sha, merge_method });
		return { ok: true };
	} catch (error) {
		const status = errorStatus(error);
		if (status === 409) {
			return {
				ok: false,
				message: "The branch changed since you looked. Review the new changes, then merge.",
			};
		}
		if (status === 405) {
			return { ok: false, message: "GitHub won't merge this yet. Check conflicts and branch rules." };
		}
		if (status === 403) {
			return { ok: false, message: "The GitHub App isn't allowed to merge in this repository." };
		}
		throw error;
	}
}

const LOG_CHARS = 8000;

function logTail(data: unknown) {
	if (typeof data !== "string") return "";
	return (
		data
			.replace(/\u001b\[[0-9;]*m/g, "")
			.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, "")
			.trim()
			.slice(-LOG_CHARS)
	);
}

/** The message asking the agent to fix a failed check, or null if it is not a failure of this PR. */
export async function failureReport(
	client: PullClient,
	fullName: string,
	number: number,
	checkRunId: number,
) {
	const repo = splitRepo(fullName);
	const [{ data: pull }, { data: run }] = await Promise.all([
		client.pulls.get({ ...repo, pull_number: number }),
		client.checks.get({ ...repo, check_run_id: checkRunId }),
	]);
	if (run.head_sha !== pull.head.sha || runState(run) !== "failed") return null;

	// Details are best effort: the name alone is still worth sending.
	const [annotations, log] = await Promise.all([
		client.checks
			.listAnnotations({ ...repo, check_run_id: checkRunId, per_page: 20 })
			// Warnings are not why it failed, and they lead the agent to change other things.
			.then((response) => response.data.filter((note) => !["notice", "warning"].includes(note.annotation_level ?? "")))
			.catch(() => []),
		client.actions
			.downloadJobLogsForWorkflowRun({ ...repo, job_id: checkRunId })
			.then((response) => logTail(response.data))
			.catch(() => ""),
	]);

	const parts = [`The check "${run.name}" failed on pull request #${number}. Please fix it.`];
	const summary = [run.output.title, run.output.summary].filter(Boolean).join("\n").slice(0, 2000);
	if (summary) parts.push(summary);
	if (annotations.length > 0) {
		parts.push(
			annotations
				.map((note) => `${note.path}:${note.start_line} ${(note.message ?? "").slice(0, 300)}`)
				.join("\n"),
		);
	}
	if (log) parts.push(`End of the log:\n${log}`);
	return parts.join("\n\n").slice(0, MAX_MESSAGE_LENGTH);
}
