"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
	fixCheck,
	mergePullRequest,
	type PullActionResult,
	sendComments,
	updateFromBase,
} from "@/actions/pull-request";
import { PullComments } from "@/components/dashboard/pull-comments";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/styles";
import { type CheckState, type PullResponse, type PullStatus, summarizeChecks } from "@/lib/pr";

type Props = {
	chatId: string;
	number: number;
	url: string;
	model: string;
	/** An agent run is queued or running, so merging and fixing wait. */
	busy: boolean;
	/** The chat is already marked done. */
	done: boolean;
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

function settling(pull: PullStatus) {
	return (
		(pull.status === "open" || pull.status === "draft") &&
		(pull.blocker !== null || pull.checks.some((check) => check.state === "pending"))
	);
}

export function PullBar({ chatId, number, url, model, busy, done, refreshKey }: Props) {
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
	const mergeable = pull?.status === "open" && pull.blocker === null && !busy;

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
						<button
							type="button"
							disabled={pending || busy}
							onClick={() => act(() => updateFromBase({ chatId, model }))}
							className={buttonClass("secondary", "sm")}
						>
							Update from base
						</button>
						{confirming === pull.headSha ? (
							<>
								<button
									type="button"
									disabled={pending || !mergeable}
									onClick={() => act(() => mergePullRequest({ chatId, sha: pull.headSha }))}
									className={buttonClass("primary", "sm")}
								>
									{pending ? "Merging..." : "Confirm merge"}
								</button>
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
						{pull.checks.map((check) => {
							const { checkRunId } = check;
							return (
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
									{check.state === "failed" && checkRunId !== null && (
										<button
											type="button"
											disabled={pending || busy}
											onClick={() => act(() => fixCheck({ chatId, checkRunId, model }))}
											className={buttonClass("secondary", "sm")}
										>
											Fix this
										</button>
									)}
								</li>
							);
						})}
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

			{open && pull?.checksUnavailable && (
				<p className="text-sm text-muted">
					Some checks can&apos;t be read. Give the GitHub App read access to Checks and Commit statuses.
				</p>
			)}
			{open && busy && <p className="text-sm text-muted">Merging waits until the agent finishes.</p>}
			{open && !busy && pull?.blocker && <p className="text-sm text-muted">{pull.blocker}</p>}
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
