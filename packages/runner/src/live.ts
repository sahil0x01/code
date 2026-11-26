import type { AgentDelta } from "@nullfuse/agent";
import type { RunLive } from "@nullfuse/db";

const KEEP_CHARS = 4000;
const DEFAULT_EVERY_MS = 400;

/**
 * Collects the model's output as it arrives and saves it a few times a second, one write at a
 * time. A failed write only costs a moment of the live view, so it never fails the run.
 */
export function liveWriter(options: {
	save: (live: RunLive) => Promise<void>;
	clean: (text: string) => string;
	everyMs?: number;
}) {
	let step = 0;
	let reasoning = "";
	let text = "";
	let tool: string | null = null;
	let dirty = false;
	let timer: NodeJS.Timeout | undefined;
	let writing: Promise<void> = Promise.resolve();

	const flush = () => {
		timer = undefined;
		writing = writing.then(async () => {
			if (!dirty) return;
			dirty = false;
			const live = {
				stepIndex: step,
				// Cleaned as a whole before cutting, so a secret cannot be split by the cut.
				reasoning: options.clean(reasoning).slice(-KEEP_CHARS),
				text: options.clean(text).slice(-KEEP_CHARS),
				tool,
			};
			await options.save(live).catch(() => {});
		});
	};

	return {
		add(delta: AgentDelta) {
			if (delta.kind === "tool") tool = delta.name;
			else if (delta.kind === "reasoning") reasoning += delta.text;
			else text += delta.text;
			dirty = true;
			timer ??= setTimeout(flush, options.everyMs ?? DEFAULT_EVERY_MS);
		},
		/** Drops the current step and waits for a write in progress, before the step is saved. */
		async next(stepIndex: number) {
			clearTimeout(timer);
			timer = undefined;
			dirty = false;
			await writing;
			step = stepIndex;
			reasoning = "";
			text = "";
			tool = null;
		},
	};
}
