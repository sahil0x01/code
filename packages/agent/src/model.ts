import { createDeepSeek } from "@ai-sdk/deepseek";
import type { JSONValue } from "ai";

export const DEEPSEEK_MODEL_IDS = ["deepseek-v4-pro", "deepseek-flash"] as const;
export type DeepSeekModelId = (typeof DEEPSEEK_MODEL_IDS)[number];

export function createDeepSeekModel(modelId: DeepSeekModelId, options: { apiKey?: string } = {}) {
	const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
	if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set");
	return createDeepSeek({ apiKey }).chat(modelId);
}

export const REASONING_LEVELS = ["off", "low", "high", "max"] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

/** How hard the model thinks before answering, as DeepSeek's own settings. */
export function reasoningOptions(level: ReasoningLevel): Record<string, Record<string, JSONValue>> {
	return {
		deepseek:
			level === "off"
				? { thinking: { type: "disabled" } }
				: { thinking: { type: "enabled" }, reasoningEffort: level },
	};
}
