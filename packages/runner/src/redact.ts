import type { StepRecord } from "@nullfuse/agent";

// A shorter value would also match ordinary text and corrupt it.
const MIN_SECRET_LENGTH = 4;

export function redactor(secrets: string[]) {
	const values = [...new Set(secrets.filter((secret) => secret.length >= MIN_SECRET_LENGTH))].sort(
		(a, b) => b.length - a.length,
	);

	const text = (input: string) => values.reduce((out, value) => out.split(value).join("[hidden]"), input);

	const deep = (value: unknown): unknown => {
		if (typeof value === "string") return text(value);
		if (Array.isArray(value)) return value.map(deep);
		if (value !== null && typeof value === "object") {
			return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deep(item)]));
		}
		return value;
	};

	const longest = values[0]?.length ?? 0;

	return {
		text,
		/**
		 * For text still being written: the end is held back, because a secret that has only
		 * half arrived would not match yet.
		 */
		partial: (input: string) => {
			const clean = text(input);
			return longest === 0 ? clean : clean.slice(0, Math.max(0, clean.length - longest + 1));
		},
		step: (step: StepRecord): StepRecord => ({
			...step,
			text: text(step.text),
			reasoning: text(step.reasoning),
			toolCalls: step.toolCalls.map((call) => ({ ...call, input: deep(call.input) })),
			toolResults: step.toolResults.map((result) => ({ ...result, output: text(result.output) })),
		}),
	};
}
