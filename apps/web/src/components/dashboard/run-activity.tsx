"use client";

import type { ActivityCall, ActivityResult, ActivityStep } from "@nullfuse/db";
import { type ReactNode, useEffect, useRef } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { formatTokens } from "@/lib/format";
import { Markdown } from "./markdown";
import { useLive } from "./use-live";
import { useSmoothText } from "./use-smooth-text";

const verbs: Record<string, [done: string, doing: string]> = {
	list: ["Listed", "Listing files"],
	read: ["Read", "Reading"],
	grep: ["Searched", "Searching"],
	edit: ["Edited", "Editing"],
	write: ["Wrote", "Writing"],
	bash: ["Ran", "Preparing a command"],
	check_app: ["Checked the app", "Preparing a browser check"],
};

const mark = { working: "blink bg-blue", failed: "bg-red" } as const;

function Pixel({ state }: { state: keyof typeof mark }) {
	return <span aria-hidden="true" className={`size-1.5 shrink-0 ${mark[state]}`} />;
}

function Thought({ text, tokens, live }: { text: string; tokens: number; live: boolean }) {
	const shown = useSmoothText(text, live);
	const box = useRef<HTMLParagraphElement>(null);
	// Follows the newest line while the model is thinking.
	useEffect(() => {
		if (live && shown && box.current) box.current.scrollTop = box.current.scrollHeight;
	}, [shown, live]);

	return (
		<Disclosure
			defaultOpen={live}
			summaryClass="font-mono text-xs"
			summary={
				live ? (
					<span className="flex items-center gap-2">
						Thinking <Pixel state="working" />
					</span>
				) : (
					`Thought${tokens > 0 ? ` · ${formatTokens(tokens)} tokens` : ""}`
				)
			}
		>
			<p
				ref={box}
				className="mt-1.5 ml-1 max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted"
			>
				{shown}
			</p>
		</Disclosure>
	);
}

function ToolCall({ call, result }: { call: ActivityCall; result: ActivityResult | undefined }) {
	const row = (
		<span className="flex min-w-0 items-center gap-2">
			{result?.isError && <Pixel state="failed" />}
			<span className="shrink-0 font-medium text-foreground">{verbs[call.name]?.[0] ?? call.name}</span>
			<span className="min-w-0 truncate text-muted">{call.label}</span>
		</span>
	);
	if (!result?.preview) return <p className="flex pl-4 font-mono text-xs">{row}</p>;
	return (
		<Disclosure defaultOpen={result.isError} summaryClass="w-full font-mono text-xs" summary={row}>
			<pre
				className={`mt-1.5 ml-4 max-h-48 overflow-auto whitespace-pre-wrap break-words border border-border bg-surface p-2 font-mono text-xs ${
					result.isError ? "text-red" : "text-muted"
				}`}
			>
				{result.preview}
			</pre>
		</Disclosure>
	);
}

function Reply({ text, live }: { text: string; live: boolean }) {
	const shown = useSmoothText(text, live);
	return <Markdown text={shown} />;
}

type Props = {
	chatId: string;
	runId: string;
	active: boolean;
	running: boolean;
	steps: ActivityStep[];
	/** The line that opens and closes the steps. */
	summary: ReactNode;
};

/** A run's steps as one list, with the step being written at its end. */
export function RunActivity({ chatId, runId, active, running, steps, summary }: Props) {
	const live = useLive(chatId, runId, running);
	const saved = live ? steps.find((step) => step.stepIndex === live.stepIndex) : undefined;
	const pending = live && !saved ? live : null;
	const last = steps.at(-1);
	// The closing reply stays visible while the run saves its work. It becomes a message after.
	const closing = running && last && last.calls.length === 0 ? last : undefined;
	const reply =
		pending?.text || (closing ? (live?.stepIndex === closing.stepIndex && live.text) || closing.text : "");

	// One list with one key per step, so a live step turns into the saved one in place.
	const entries = [
		...steps.map((step) => ({ index: step.stepIndex, step, live: null })),
		...(pending ? [{ index: pending.stepIndex, step: null, live: pending }] : []),
	];

	return (
		<div className="flex flex-col gap-3">
			<Disclosure defaultOpen={active} summaryClass="font-mono text-xs" summary={summary}>
				<ol className="mt-3 ml-1 flex flex-col gap-2 border-l-2 border-border pl-4">
					{entries.map(({ index, step, live: writing }) => {
						const reasoning = step?.reasoning ?? writing?.reasoning;
						return (
							<li key={index} className="appear flex min-w-0 flex-col gap-1.5">
								{reasoning && (
									<Thought text={reasoning} tokens={step?.reasoningTokens ?? 0} live={writing !== null && !writing.text} />
								)}
								{step && step.text && step.calls.length > 0 && <Markdown text={step.text} />}
								{step?.calls.map((call) => (
									<ToolCall key={call.id} call={call} result={step.results.find((r) => r.id === call.id)} />
								))}
								{writing?.tool && (
									<p className="flex items-center gap-2 pl-4 font-mono text-xs text-muted">
										<Pixel state="working" />
										{verbs[writing.tool]?.[1] ?? `Preparing ${writing.tool}`}
									</p>
								)}
							</li>
						);
					})}
					{running && !pending && (
						<li className="flex items-center gap-2 pl-4 font-mono text-xs text-muted">
							<Pixel state="working" />
							{steps.length === 0 ? "Setting up the workspace" : "Working"}
						</li>
					)}
				</ol>
			</Disclosure>
			{reply && <Reply text={reply} live={pending !== null} />}
		</div>
	);
}
