import type { ActivityStep, listRuns } from "@nullfuse/db";
import { stopRun } from "@/actions/chats";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/styles";
import { formatCost, formatTokens } from "@/lib/format";
import { durationSince } from "@/lib/time";
import { RunActivity } from "./run-activity";
import { RunStatusBadge } from "./run-status";

export type RunRow = Awaited<ReturnType<typeof listRuns>>[number];

function Verification({ verification }: { verification: RunRow["verification"] }) {
	if (!verification) {
		return (
			<p className="text-sm text-muted">
				Tests were not run: the project has no test command, or the run stopped first.
			</p>
		);
	}
	const passed = verification.exitCode === 0 && !verification.timedOut;
	const seconds = Math.round(verification.durationMs / 1000);
	return (
		<Disclosure
			summaryClass="font-mono text-xs uppercase"
			summary={
				<span>
					<span className={passed ? "text-green" : "text-red"}>{passed ? "Tests passed" : "Tests failed"}</span>
					{" · "}
					{verification.timedOut ? "timed out" : `exit ${verification.exitCode}`}
					{" · "}
					{seconds}s
				</span>
			}
		>
			<p className="mt-2 font-mono text-xs text-muted">{verification.command}</p>
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
				{verification.output || "(no output)"}
			</pre>
		</Disclosure>
	);
}

function Proof({ chatId, run, canPlay }: { chatId: string; run: RunRow; canPlay: boolean }) {
	const { recording } = run;
	// Runs from before proof was kept, and runs cancelled before they started, have none.
	if (!recording) return null;
	if (recording.status === "skipped") {
		return (
			<Disclosure summaryClass="text-sm" summary={recording.message}>
				{recording.detail && (
					<pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
						{recording.detail}
					</pre>
				)}
			</Disclosure>
		);
	}
	if (!canPlay) {
		return (
			<p role="alert" className="text-sm text-red">
				Proof was recorded, but the web app has no video storage settings. Add the four R2
				values to its environment and restart it.
			</p>
		);
	}
	const base = `/api/chats/${chatId}/runs/${run.id}`;
	const web = recording.kind !== "page";
	const verdict = web
		? recording.passed ? "checks passed" : "checks failed"
		: recording.passed ? "recorded" : "a command failed";
	return (
		<figure className="flex flex-col gap-1.5">
			<figcaption className="flex flex-wrap items-center gap-3 font-mono text-xs uppercase">
				<span className={recording.passed ? "text-green" : "text-red"}>
					Proof · {web ? "app" : "work record"} · {verdict}
				</span>
				<a href={`${base}/video`} target="_blank" rel="noreferrer" className="text-muted underline">
					Open video ↗
				</a>
			</figcaption>
			<video src={`${base}/video`} controls muted preload="metadata" className="w-full border border-border" />
			{recording.screenshots && recording.screenshots.length > 0 && (
				<ul className="flex flex-wrap gap-2">
					{recording.screenshots.map((shot, number) => (
						<li key={shot.key} className="w-40">
							<a href={`${base}/screenshot/${number}`} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
								{/* A short-lived private link, which the image optimiser cannot fetch. */}
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img
									src={`${base}/screenshot/${number}`}
									alt={shot.label || `Screenshot ${number + 1}`}
									loading="lazy"
									className="h-24 w-full border border-border object-cover object-top"
								/>
								<span className="truncate text-xs text-muted">{shot.label || `Screenshot ${number + 1}`}</span>
							</a>
						</li>
					))}
				</ul>
			)}
			{recording.error && (
				<p className="whitespace-pre-wrap break-words font-mono text-xs text-red">{recording.error}</p>
			)}
		</figure>
	);
}

export function RunPanel({
	chatId,
	run,
	steps,
	ahead,
	canPlay,
}: {
	chatId: string;
	canPlay: boolean;
	run: RunRow;
	steps: ActivityStep[];
	ahead: number;
}) {
	const active = run.status === "queued" || run.status === "running";
	const detail = (count: number, note: string) => (count > 0 ? ` (${formatTokens(count)} ${note})` : "");
	const facts = [
		steps.length > 0 && `${steps.length} ${steps.length === 1 ? "step" : "steps"}`,
		run.startedAt && durationSince(run.startedAt, run.finishedAt),
		run.inputTokens > 0 &&
			`${formatTokens(run.inputTokens)} in${detail(run.cachedInputTokens, "cached")}`,
		run.outputTokens > 0 &&
			`${formatTokens(run.outputTokens)} out${detail(run.reasoningTokens, "thinking")}`,
		run.modelCost + run.sandboxCost > 0 && `about ${formatCost(run.modelCost + run.sandboxCost)}`,
		run.planOnly && "plan only",
		`${run.modelLabel ? `${run.modelLabel} (your key)` : run.model} · thinking ${run.reasoning}`,
	].filter(Boolean);

	return (
		<div className="flex flex-col gap-2">
			<RunActivity
				chatId={chatId}
				runId={run.id}
				active={active}
				running={run.status === "running"}
				steps={steps}
				summary={
					<>
						<RunStatusBadge status={run.status} ahead={ahead} />
						<span className="font-mono text-xs text-subtle">{facts.join(" · ")}</span>
					</>
				}
			/>

			{run.status === "queued" && (
				<form action={stopRun}>
					<input type="hidden" name="runId" value={run.id} />
					<button type="submit" className={buttonClass("secondary", "sm")}>
						Cancel
					</button>
				</form>
			)}

			{run.error && (
				<p role="alert" className="text-sm text-red">
					{run.error}
				</p>
			)}

			{run.verify && !active && <Verification verification={run.verification} />}

			{!active && <Proof chatId={chatId} run={run} canPlay={canPlay} />}
		</div>
	);
}
