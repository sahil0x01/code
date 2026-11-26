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

	return {
		text,
		step: (step: StepRecord): StepRecord => ({
			...step,
			text: text(step.text),
			reasoning: text(step.reasoning),
			toolCalls: step.toolCalls.map((call) => ({ ...call, input: deep(call.input) })),
			toolResults: step.toolResults.map((result) => ({ ...result, output: text(result.output) })),
		}),
	};
}
