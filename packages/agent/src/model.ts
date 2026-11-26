import { createDeepSeek } from "@ai-sdk/deepseek";

export const DEEPSEEK_MODEL_IDS = ["deepseek-v4-pro", "deepseek-flash"] as const;
export type DeepSeekModelId = (typeof DEEPSEEK_MODEL_IDS)[number];

export function createDeepSeekModel(modelId: DeepSeekModelId, options: { apiKey?: string } = {}) {
	const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
	if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
	return createDeepSeek({ apiKey }).chat(modelId);
}
