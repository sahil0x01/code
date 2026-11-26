import type { AgentStep } from "./agent";

// Same shape as `StepRecord` in @nullfuse/db, which this package does not import.
export type StepRecord = {
	stepIndex: number;
	finishReason: string;
	text: string;
	/** The model's thinking before this step, when it shares it. */
	reasoning: string;
	toolCalls: { id: string; name: string; input: unknown }[];
	toolResults: { id: string; name: string; output: string; isError: boolean }[];
	inputTokens: number;
	outputTokens: number;
	/** Part of the input that came from the provider's cache. */
	cachedInputTokens: number;
	/** Part of the output spent thinking. */
	reasoningTokens: number;
};

// The model sees full output; the database keeps enough to show what happened.
const MAX_OUTPUT_CHARS = 10_000;
const MAX_INPUT_STRING_CHARS = 2_000;

function clip(text: string, max: number) {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n[... ${text.length - max} characters not stored ...]`;
}

function clipStrings(value: unknown): unknown {
	if (typeof value === "string") return clip(value, MAX_INPUT_STRING_CHARS);
	if (Array.isArray(value)) return value.map(clipStrings);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clipStrings(item)]));
	}
	return value;
}

function asText(output: unknown) {
	return typeof output === "string" ? output : (JSON.stringify(output) ?? "");
}

export function toStepRecord(step: AgentStep): StepRecord {
	const results = new Map(step.toolResults.map((result) => [result.toolCallId, asText(result.output)]));
	const errors = new Map(
		step.content.flatMap((part) =>
			part.type === "tool-error"
				? [[part.toolCallId, part.error instanceof Error ? part.error.message : String(part.error)] as const]
				: [],
		),
	);

	return {
		stepIndex: step.stepNumber,
		finishReason: step.finishReason,
		text: step.text,
		reasoning: clip(step.reasoningText ?? "", MAX_OUTPUT_CHARS),
		toolCalls: step.toolCalls.map((call) => ({
			id: call.toolCallId,
			name: call.toolName,
			input: clipStrings(call.input),
		})),
		toolResults: step.toolCalls.flatMap((call): StepRecord["toolResults"] => {
			const error = errors.get(call.toolCallId);
			if (error !== undefined) {
				return [{ id: call.toolCallId, name: call.toolName, output: clip(error, MAX_OUTPUT_CHARS), isError: true }];
			}
			const output = results.get(call.toolCallId);
			if (output === undefined) return [];
			return [{ id: call.toolCallId, name: call.toolName, output: clip(output, MAX_OUTPUT_CHARS), isError: false }];
		}),
		inputTokens: step.usage.inputTokens ?? 0,
		outputTokens: step.usage.outputTokens ?? 0,
		cachedInputTokens: step.usage.inputTokenDetails?.cacheReadTokens ?? 0,
		reasoningTokens: step.usage.outputTokenDetails?.reasoningTokens ?? 0,
	};
}
