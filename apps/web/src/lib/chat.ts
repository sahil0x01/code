export const MODELS = [
	{ id: "glm-5.3", label: "GLM-5.3", hint: "Default" },
	{ id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "Cheaper" },
	{ id: "kimi-k3.1-pro", label: "Kimi K3.1 Pro", hint: "Max" },
] as const;

export type ModelId = (typeof MODELS)[number]["id"];

export const DEFAULT_MODEL_ID: ModelId = "glm-5.3";

export function isModelId(value: string): value is ModelId {
	return MODELS.some((model) => model.id === value);
}

export const MAX_MESSAGE_LENGTH = 20_000;
