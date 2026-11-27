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

function Recording({ chatId, run, canPlay }: { chatId: string; run: RunRow; canPlay: boolean }) {
	const { recording } = run;
	if (!recording) return <p className="text-sm text-muted">No video was recorded.</p>;
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
				A video was recorded, but the web app has no video storage settings. Add the four R2
				values to its environment and restart it.
			</p>
		);
	}
	const source = `/api/chats/${chatId}/runs/${run.id}/video`;
	return (
		<figure className="flex flex-col gap-1.5">
			<figcaption className="flex flex-wrap items-center gap-3 font-mono text-xs uppercase">
				<span className={recording.passed ? "text-green" : "text-red"}>
					Recording · {recording.passed ? "checks passed" : "checks failed"}
				</span>
				<a href={source} target="_blank" rel="noreferrer" className="text-muted underline">
					Open ↗
				</a>
			</figcaption>
			<video src={source} controls muted preload="metadata" className="w-full border border-border" />
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

			{run.record && !active && <Recording chatId={chatId} run={run} canPlay={canPlay} />}
		</div>
	);
}
