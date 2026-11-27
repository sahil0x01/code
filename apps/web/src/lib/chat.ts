import { parseOwnModelKey } from "@nullfuse/models/providers";

export const MODELS = [
	{ id: "deepseek-flash", label: "DeepSeek Flash", hint: "Default" },
	{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "Costs more" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"] | `own:${string}`;

export const DEFAULT_MODEL_ID: ModelId = "deepseek-flash";

export function isModelId(value: string): value is ModelId {
	// Whether a user's own model is still theirs is checked when the message is saved.
	return MODELS.some((model) => model.id === value) || parseOwnModelKey(value) !== null;
}

export const REASONING_OPTIONS = [
	{ id: "off", label: "Thinking off" },
	{ id: "low", label: "Low thinking" },
	{ id: "high", label: "High thinking" },
	{ id: "max", label: "Max thinking" },
] as const;

export type ReasoningId = (typeof REASONING_OPTIONS)[number]["id"];

export const DEFAULT_REASONING: ReasoningId = "high";

export function isReasoningId(value: unknown): value is ReasoningId {
	return REASONING_OPTIONS.some((option) => option.id === value);
}

export const MAX_MESSAGE_LENGTH = 20_000;
