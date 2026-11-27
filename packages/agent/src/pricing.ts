import type { DeepSeekModelId } from "./model";

// DeepSeek's list prices in US dollars per million tokens, read 2026-11-27 from
// api-docs.deepseek.com/quick_start/pricing. Peak hours cost twice as much.
const OFF_PEAK: Record<DeepSeekModelId, { cached: number; input: number; output: number }> = {
	"deepseek-v4-pro": { cached: 0.022, input: 0.66, output: 1.98 },
	"deepseek-flash": { cached: 0.003, input: 0.15, output: 0.6 },
};

export type TokenUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

// 01:00-04:00 and 06:00-10:00 UTC on weekdays. Chinese public holidays are also off-peak,
// but are not tracked here, so cost on those days is over-estimated.
export function isPeak(at: Date) {
	const day = at.getUTCDay();
	const hour = at.getUTCHours();
	return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

/** An estimate in millionths of a dollar. A dollar price per million tokens is that per token. */
export function modelCost(model: DeepSeekModelId, usage: TokenUsage, at: Date) {
	const price = OFF_PEAK[model];
	const cached = Math.min(usage.cachedInputTokens, usage.inputTokens);
	const total =
		cached * price.cached + (usage.inputTokens - cached) * price.input + usage.outputTokens * price.output;
	return Math.round(total * (isPeak(at) ? 2 : 1));
}

/** The model that answered, which differs from the one asked for after a fallback. */
export function priceModel(answered: string | undefined, asked: string): DeepSeekModelId {
	for (const name of [answered, asked]) {
		if (name?.includes("flash")) return "deepseek-flash";
		if (name?.includes("pro")) return "deepseek-v4-pro";
	}
	// An unknown model is priced as the dearest, so the spending cap still holds.
	return "deepseek-v4-pro";
}
