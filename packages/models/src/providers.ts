// No imports, so browser code can use this file.
export const PROVIDERS = [
	{ id: "openai", label: "OpenAI" },
	{ id: "anthropic", label: "Anthropic" },
	{ id: "google", label: "Google" },
	{ id: "deepseek", label: "DeepSeek" },
	{ id: "openai-compatible", label: "OpenAI-compatible (own address)" },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export function isProviderId(value: unknown): value is ProviderId {
	return PROVIDERS.some((provider) => provider.id === value);
}

/** Below this, long chats are likely to outgrow the model. */
export const SMALL_CONTEXT_TOKENS = 128_000;

const OWN = /^own:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** How a user's own model is named on a run. Any "own:" name must never use our key. */
export const ownModelKey = (id: string) => `own:${id}`;
export const isOwnModelKey = (model: string) => model.startsWith("own:");
export const parseOwnModelKey = (model: string) => OWN.exec(model)?.[1] ?? null;
