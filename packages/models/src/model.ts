import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { JSONValue, LanguageModel } from "ai";
import type { ProviderId } from "./providers";
import { guardedFetch, type UrlRules } from "./safe-url";

export type ModelConfig = {
	provider: ProviderId;
	modelId: string;
	apiKey: string;
	/** Only for an OpenAI-compatible provider. */
	baseUrl?: string | null;
};

export type ModelOptions = UrlRules & {
	/** Replaces the network, for tests. */
	fetch?: typeof fetch;
};

export function createUserModel(config: ModelConfig, options: ModelOptions = {}): LanguageModel {
	const { apiKey, modelId } = config;
	// The key is always passed in, so a provider can never pick up ours from the environment.
	if (!apiKey) throw new Error("The API key is empty.");
	const settings = { apiKey, fetch: options.fetch };
	switch (config.provider) {
		case "openai":
			return createOpenAI({ ...settings, baseURL: "https://api.openai.com/v1" })(modelId);
		case "anthropic":
			return createAnthropic({ ...settings, baseURL: "https://api.anthropic.com/v1" })(modelId);
		case "google":
			return createGoogle({
				...settings,
				baseURL: "https://generativelanguage.googleapis.com/v1beta",
			})(modelId);
		case "deepseek":
			return createDeepSeek({ ...settings, baseURL: "https://api.deepseek.com" }).chat(modelId);
		case "openai-compatible":
			if (!config.baseUrl) throw new Error("This model needs an address.");
			return createOpenAICompatible({
				name: "custom",
				apiKey,
				baseURL: config.baseUrl,
				fetch: options.fetch ?? guardedFetch(options),
				includeUsage: true,
			}).chatModel(modelId);
	}
}

export type ThinkingLevel = "off" | "low" | "high" | "max";

export type CallSettings = {
	reasoning?: "none" | "low" | "high" | "xhigh";
	providerOptions?: Record<string, Record<string, JSONValue>>;
	maxOutputTokens?: number;
};

// Anthropic requires a limit, and the SDK assumes a very low one for names it does not know.
const MAX_ANTHROPIC_OUTPUT = 64_000;

const EFFORT = { off: "none", low: "low", high: "high", max: "xhigh" } as const;

/** How the chat's thinking level, and anything else a provider needs, is sent. */
export function callSettings(
	provider: ProviderId,
	level: ThinkingLevel,
	maxOutputTokens?: number | null,
): CallSettings {
	switch (provider) {
		case "openai":
			// Nothing is kept on OpenAI's side.
			return { reasoning: EFFORT[level], providerOptions: { openai: { store: false } } };
		case "anthropic":
			// Without this every step pays full price for the whole conversation again.
			return {
				reasoning: EFFORT[level],
				providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
				...(maxOutputTokens && { maxOutputTokens: Math.min(maxOutputTokens, MAX_ANTHROPIC_OUTPUT) }),
			};
		case "google":
			return { reasoning: EFFORT[level] };
		case "deepseek":
			return {
				providerOptions: {
					deepseek:
						level === "off"
							? { thinking: { type: "disabled" } }
							: { thinking: { type: "enabled" }, reasoningEffort: level },
				},
			};
		// Many servers reject settings they do not know, so theirs are left as they are.
		case "openai-compatible":
			return {};
	}
}
