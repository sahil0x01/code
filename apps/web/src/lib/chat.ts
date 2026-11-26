export const MODELS = [
	{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "Default" },
	{ id: "deepseek-flash", label: "DeepSeek Flash", hint: "Cheaper" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "deepseek-v4-pro";

export function isModelId(value: string): value is ModelId {
	return MODELS.some((model) => model.id === value);
}

export const MAX_MESSAGE_LENGTH = 20_000;
