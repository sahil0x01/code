import type { ActivityStep, listRuns } from "@nullfuse/db";
import { stopRun } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";
import { formatTokens } from "@/lib/format";
import { durationSince } from "@/lib/time";
import { RunStatusBadge } from "./run-status";

export type RunRow = Awaited<ReturnType<typeof listRuns>>[number];

function Step({ step }: { step: ActivityStep }) {
	const results = new Map(step.results.map((result) => [result.id, result]));

	return (
		<li className="flex flex-col gap-1">
			{step.text && step.calls.length > 0 && (
				<p className="whitespace-pre-wrap break-words text-sm">{step.text}</p>
			)}
			{step.calls.map((call) => {
				const result = results.get(call.id);
				return (
					<div key={call.id} className="flex flex-col gap-0.5">
						<p className="flex items-baseline gap-2 font-mono text-xs">
							<span
								aria-hidden="true"
								className={result?.isError ? "text-red" : "text-subtle"}
							>
								{result?.isError ? "✗" : "›"}
							</span>
							<span className="font-medium">{call.name}</span>
							<span className="min-w-0 truncate text-muted">{call.label}</span>
						</p>
						{result?.isError && (
							<p className="ml-5 whitespace-pre-wrap break-words font-mono text-xs text-red">
								{result.preview}
							</p>
						)}
					</div>
				);
			})}
		</li>
	);
}

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
		<details className="flex flex-col gap-2">
			<summary className="w-fit cursor-pointer font-mono text-xs uppercase text-subtle hover:text-foreground">
				<span className={passed ? "text-green" : "text-red"}>{passed ? "Tests passed" : "Tests failed"}</span>
				{" · "}
				{verification.timedOut ? "timed out" : `exit ${verification.exitCode}`}
				{" · "}
				{seconds}s
			</summary>
			<p className="font-mono text-xs text-muted">{verification.command}</p>
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
				{verification.output || "(no output)"}
			</pre>
		</details>
	);
}

export function RunPanel({ run, steps, ahead }: { run: RunRow; steps: ActivityStep[]; ahead: number }) {
	const active = run.status === "queued" || run.status === "running";
	const tokens = run.inputTokens + run.outputTokens;
	const facts = [
		steps.length > 0 && `${steps.length} ${steps.length === 1 ? "step" : "steps"}`,
		run.startedAt && durationSince(run.startedAt, run.finishedAt),
		tokens > 0 && `${formatTokens(tokens)} tokens`,
		run.model,
	].filter(Boolean);

	return (
		<div className="flex flex-col gap-2">
			<details open={active}>
				<summary className="flex w-fit cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 hover:text-foreground">
					<RunStatusBadge status={run.status} ahead={ahead} />
					<span className="font-mono text-xs text-subtle">{facts.join(" · ")}</span>
				</summary>
				{steps.length > 0 && (
					<ol className="mt-3 flex flex-col gap-2 border-l-2 border-border pl-4">
						{steps.map((step) => (
							<Step key={step.stepIndex} step={step} />
						))}
					</ol>
				)}
			</details>

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

			{run.status === "running" && steps.length === 0 && (
				<p className="text-sm text-muted">Setting up the workspace...</p>
			)}
		</div>
	);
}
