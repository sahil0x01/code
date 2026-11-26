import type { ActivityStep, ChangedFile, listRuns } from "@nullfuse/db";
import { stopRun } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";
import { formatTokens } from "@/lib/format";
import { durationSince } from "@/lib/time";
import { RunStatusBadge } from "./run-status";

export type RunRow = Awaited<ReturnType<typeof listRuns>>[number];

const fileStatus: Record<ChangedFile["status"], { letter: string; color: string }> = {
	added: { letter: "A", color: "text-green" },
	modified: { letter: "M", color: "text-muted" },
	deleted: { letter: "D", color: "text-red" },
	renamed: { letter: "R", color: "text-blue" },
};

function Step({ step }: { step: ActivityStep }) {
	const results = new Map(step.results.map((result) => [result.id, result]));

	return (
		<li className="flex flex-col gap-1">
			<div className="flex items-baseline gap-2">
				<span className="w-6 shrink-0 font-mono text-xs text-subtle">{step.stepIndex + 1}</span>
				{step.text && <p className="min-w-0 whitespace-pre-wrap break-words text-sm">{step.text}</p>}
				{!step.text && step.calls.length === 0 && (
					<span className="text-sm text-muted">Finished</span>
				)}
			</div>
			{step.calls.map((call) => {
				const result = results.get(call.id);
				return (
					<div key={call.id} className="ml-8 flex flex-col gap-0.5">
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

	return (
		<div className="ml-3 flex flex-col gap-3 border-l-2 border-border pl-4">
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
				<RunStatusBadge status={run.status} ahead={ahead} />
				<span className="font-mono text-xs text-subtle">{run.model}</span>
				{tokens > 0 && (
					<span className="font-mono text-xs text-subtle">{formatTokens(tokens)} tokens</span>
				)}
				{run.startedAt && (
					<span className="font-mono text-xs text-subtle">
						{durationSince(run.startedAt, run.finishedAt)}
					</span>
				)}
				{run.status === "queued" && (
					<form action={stopRun}>
						<input type="hidden" name="runId" value={run.id} />
						<button type="submit" className={buttonClass("secondary", "sm")}>
							Cancel
						</button>
					</form>
				)}
				{run.status === "running" &&
					(run.stopRequestedAt ? (
						<button type="button" disabled className={buttonClass("secondary", "sm")}>
							Stopping...
						</button>
					) : (
						<form action={stopRun}>
							<input type="hidden" name="runId" value={run.id} />
							<button type="submit" className={buttonClass("secondary", "sm")}>
								Stop
							</button>
						</form>
					))}
			</div>

			{run.error && (
				<p role="alert" className="text-sm text-red">
					{run.error}
				</p>
			)}

			{run.verify && run.status !== "queued" && run.status !== "running" && (
				<Verification verification={run.verification} />
			)}

			{run.status === "running" && steps.length === 0 && (
				<p className="text-sm text-muted">Setting up the workspace...</p>
			)}

			{steps.length > 0 && (
				<details open={active} className="flex flex-col gap-2">
					<summary className="w-fit cursor-pointer font-mono text-xs uppercase text-subtle hover:text-foreground">
						Activity · {steps.length} {steps.length === 1 ? "step" : "steps"}
					</summary>
					<ol className="flex flex-col gap-3 pt-2">
						{steps.map((step) => (
							<Step key={step.stepIndex} step={step} />
						))}
					</ol>
				</details>
			)}

			{run.changedFiles.length > 0 && (
				<details open={active} className="flex flex-col gap-2">
					<summary className="w-fit cursor-pointer font-mono text-xs uppercase text-subtle hover:text-foreground">
						Files changed · {run.changedFiles.length}
					</summary>
					<ul className="flex flex-col gap-0.5 pt-2">
						{run.changedFiles.map((file) => (
							<li key={file.path} className="flex gap-2 font-mono text-xs">
								<span className={`w-4 shrink-0 ${fileStatus[file.status].color}`}>
									{fileStatus[file.status].letter}
								</span>
								<span className="min-w-0 break-all">{file.path}</span>
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}
