"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
	mergePullRequest,
	type PullActionResult,
	sendComments,
	startMerge,
	stopMerge,
} from "@/actions/pull-request";
import { PullComments } from "@/components/dashboard/pull-comments";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/styles";
import { type CheckState, type PullResponse, type PullStatus, summarizeChecks } from "@nullfuse/connectors/pulls/status";
import type { CommentsResponse } from "@/lib/comments";

type Props = {
	chatId: string;
	number: number;
	url: string;
	model: string;
	/** An agent run is queued or running, so merging and fixing wait. */
	busy: boolean;
	/** The chat already knows its pull request is merged. */
	done: boolean;
	/** A merge is waiting for checks or a fix. */
	merging: boolean;
	/** Why the last merge did not happen. */
	mergeNote: string | null;
	refreshKey: string;
};

const POLL_MS = 15_000;

const tone: Record<CheckState, string> = {
	passed: "text-green",
	failed: "text-red",
	pending: "text-muted",
	skipped: "text-subtle",
};

const mark: Record<CheckState, string> = { passed: "✓", failed: "✗", pending: "…", skipped: "–" };

const labels: Record<PullStatus["status"], string> = {
	open: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
};

/** What clicking confirm will do. */
function mergePlan(pull: PullStatus) {
	if (pull.conflicts) {
		return { label: "Fix, then merge", note: "The agent resolves the conflicts, then asks you to merge again." };
	}
	if (pull.checks.some((check) => check.state === "pending")) {
		return { label: "Merge when checks pass", note: "If a check fails, the agent fixes it and asks you to merge again." };
	}
	if (pull.checks.some((check) => check.state === "failed")) {
		return { label: "Fix, then merge", note: "The agent fixes the failed checks, then asks you to merge again." };
	}
	if (pull.checksUnavailable) {
		return { label: "Check and merge", note: "Some checks can't be read, so only Merge anyway will merge." };
	}
	return { label: "Confirm merge", note: null };
}

function useCommentCount(chatId: string, wanted: boolean) {
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (!wanted) return;
		const abort = new AbortController();
		fetch(`/api/chats/${chatId}/pr/comments`, { cache: "no-store", signal: abort.signal })
			.then((response) => response.json())
			.then((body: Partial<CommentsResponse>) => setCount(body.comments?.length ?? 0))
			// Only a reminder, so failing to count them must not get in the way.
			.catch(() => {});
		return () => abort.abort();
	}, [chatId, wanted]);
	return count;
}

function settling(pull: PullStatus) {
	return (
		(pull.status === "open" || pull.status === "draft") &&
		(pull.blocker !== null || pull.checks.some((check) => check.state === "pending"))
	);
}

export function PullBar(props: Props) {
	const { chatId, number, url, model, busy, done, merging, mergeNote, refreshKey } = props;
	const [pull, setPull] = useState<PullStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [confirming, setConfirming] = useState<string | null>(null);
	const [reload, setReload] = useState(0);
	const [pending, startAction] = useTransition();
	const router = useRouter();

	useEffect(() => {
		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			let again = false;
			if (document.visibilityState === "visible") {
				try {
					const response = await fetch(`/api/chats/${chatId}/pr`, { signal: abort.signal });
					const body = (await response.json()) as PullResponse | { error: string };
					if ("error" in body) {
						setError(body.error);
					} else {
						setError(null);
						setPull(body.state === "ok" ? body : null);
						again = body.state === "ok" && settling(body);
					}
				} catch {
					if (abort.signal.aborted) return;
					setError("Couldn't load the pull request.");
				}
			} else {
				again = true;
			}
			if (again && !abort.signal.aborted) timer = setTimeout(load, POLL_MS);
		};
		load();
		return () => {
			abort.abort();
			clearTimeout(timer);
		};
	}, [chatId, refreshKey, reload]);

	// Loading a merged pull request marks the chat done, so the page is read again.
	const merged = pull?.status === "merged";
	useEffect(() => {
		if (merged && !done) router.refresh();
	}, [merged, done, router]);

	const act = (action: () => Promise<PullActionResult>) =>
		startAction(async () => {
			const result = await action().catch(() => ({
				ok: false as const,
				message: "Something went wrong. Try again.",
			}));
			setActionError(result.ok ? null : result.message);
			setConfirming(null);
			setReload((value) => value + 1);
			router.refresh();
		});

	const summary = pull && summarizeChecks(pull.checks);
	const open = pull?.status === "open" || pull?.status === "draft";
	const mergeable = pull?.status === "open" && !busy;
	const confirmed = pull !== null && confirming === pull.headSha;
	const plan = pull && mergePlan(pull);
	const comments = useCommentCount(chatId, confirmed);

	return (
		<section
			aria-label="Pull request"
			className="flex shrink-0 flex-col gap-2 border-b border-border bg-surface px-3 py-2.5 md:px-4"
		>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<a
					href={url}
					target="_blank"
					rel="noreferrer"
					className="font-mono text-sm underline hover:text-foreground"
				>
					Pull request #{number} ↗
				</a>
				{pull && <span className="font-mono text-xs uppercase text-subtle">{labels[pull.status]}</span>}
				{open &&
					pull?.deployments.map((deployment) => (
						<a
							key={deployment.id}
							href={deployment.url}
							target="_blank"
							rel="noreferrer"
							className="font-mono text-sm underline hover:text-foreground"
						>
							{deployment.name} ↗
						</a>
					))}
				<button
					type="button"
					onClick={() => setReload(reload + 1)}
					className="font-mono text-xs text-muted underline hover:text-foreground"
				>
					Refresh
				</button>

				{open && pull && (
					<span className="ml-auto flex flex-wrap items-center gap-3">
						{merging ? (
							<button
								type="button"
								disabled={pending}
								onClick={() => act(() => stopMerge({ chatId }))}
								className={buttonClass("secondary", "sm")}
							>
								Cancel merge
							</button>
						) : confirmed ? (
							<>
								<button
									type="button"
									disabled={pending || !mergeable}
									onClick={() => act(() => startMerge({ chatId, sha: pull.headSha }))}
									className={buttonClass("primary", "sm")}
								>
									{pending ? "Merging..." : plan?.label}
								</button>
								{plan?.note && pull.blocker === null && (
									<button
										type="button"
										disabled={pending || !mergeable}
										onClick={() => act(() => mergePullRequest({ chatId, sha: pull.headSha }))}
										className={buttonClass("secondary", "sm")}
									>
										Merge anyway
									</button>
								)}
								<button type="button" onClick={() => setConfirming(null)} className={buttonClass("secondary", "sm")}>
									Cancel
								</button>
							</>
						) : (
							<button
								type="button"
								disabled={pending || !mergeable}
								onClick={() => setConfirming(pull.headSha)}
								className={buttonClass("primary", "sm")}
							>
								Merge
							</button>
						)}
					</span>
				)}
			</div>

			{summary && open && (
				<Disclosure
					summaryClass="font-mono text-xs"
					summary={<span className={tone[summary.tone]}>{summary.text}</span>}
				>
					<ul className="flex flex-col gap-1 pt-2">
						{pull.checks.map((check) => (
							<li key={check.key} className="flex flex-wrap items-center gap-2 font-mono text-xs">
								<span className={`w-4 ${tone[check.state]}`}>
									<span aria-hidden="true">{mark[check.state]}</span>
									<span className="sr-only">{check.state}</span>
								</span>
								<span className="min-w-0 break-all">{check.name}</span>
								{check.url?.startsWith("https://") && (
									<a href={check.url} target="_blank" rel="noreferrer" className="text-muted underline">
										Details ↗
									</a>
								)}
							</li>
						))}
					</ul>
				</Disclosure>
			)}

			{open && (
				<PullComments
					chatId={chatId}
					disabled={pending || busy}
					onSend={(picked) => act(() => sendComments({ chatId, model, picked }))}
				/>
			)}

			{open && confirmed && !merging && plan?.note && <p className="text-sm text-muted">{plan.note}</p>}
			{open && confirmed && !merging && comments > 0 && (
				<p className="text-sm text-muted">
					{comments === 1 ? "There is 1 comment" : `There are ${comments} comments`} on this pull request. Merging
					doesn&apos;t send them to the agent, so read them under Comments first.
				</p>
			)}
			{open && merging && (
				<p role="status" className="text-sm text-muted">
					{busy
						? "Fixing before the merge. You will be asked to merge again."
						: "Waiting to merge. You can leave this page."}
				</p>
			)}
			{open && !merging && !confirmed && mergeNote && (
				<p role="alert" className="text-sm text-red">
					{mergeNote}
				</p>
			)}
			{open && pull?.checksUnavailable && (
				<p className="text-sm text-muted">
					Some checks can&apos;t be read. Give the GitHub App read access to Checks and Commit statuses.
				</p>
			)}
			{open && busy && !merging && <p className="text-sm text-muted">Merging waits until the agent finishes.</p>}
			{open && !busy && !merging && pull?.blocker && <p className="text-sm text-muted">{pull.blocker}</p>}
			{pull?.status === "merged" && (
				<p className="text-sm text-muted">Merged. Start a new chat for further changes.</p>
			)}
			{(actionError ?? error) && (
				<p role="alert" className="text-sm text-red">
					{actionError ?? error}
				</p>
			)}
		</section>
	);
}
