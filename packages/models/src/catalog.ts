import { z } from "zod";
import type { ProviderId } from "./providers";

/** Dollars per million tokens. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export type CatalogEntry = {
	contextTokens: number | null;
	maxOutputTokens: number | null;
	price: ModelPrice | null;
};

const CATALOG_URL = "https://models.dev/api.json";
const KEEP_MS = 60 * 60_000;

const model = z.object({
	tool_call: z.boolean().optional(),
	limit: z.object({ context: z.number().optional(), output: z.number().optional() }).optional(),
	cost: z
		.object({
			input: z.number().nonnegative(),
			output: z.number().nonnegative(),
			cache_read: z.number().nonnegative().optional(),
			cache_write: z.number().nonnegative().optional(),
		})
		.optional(),
});
const provider = z.object({ models: z.record(z.string(), z.unknown()) });

type Catalog = Record<string, unknown>;
let cached: { at: number; data: Catalog } | undefined;

// A public list; nothing about the user is sent. Without it, models just have no price.
async function load(fetcher: typeof fetch): Promise<Catalog> {
	if (cached && Date.now() - cached.at < KEEP_MS) return cached.data;
	try {
		const response = await fetcher(CATALOG_URL, { signal: AbortSignal.timeout(5000) });
		if (!response.ok) return cached?.data ?? {};
		cached = { at: Date.now(), data: z.record(z.string(), z.unknown()).parse(await response.json()) };
		return cached.data;
	} catch {
		return cached?.data ?? {};
	}
}

// An own address can serve anything under any name, so nothing is assumed about it.
function modelsOf(catalog: Catalog, id: ProviderId) {
	if (id === "openai-compatible") return {};
	const parsed = provider.safeParse(catalog[id]);
	return parsed.success ? parsed.data.models : {};
}

export async function lookupModel(id: ProviderId, modelId: string, fetcher = fetch): Promise<CatalogEntry> {
	const found = model.safeParse(modelsOf(await load(fetcher), id)[modelId]);
	if (!found.success) return { contextTokens: null, maxOutputTokens: null, price: null };
	const { cost, limit } = found.data;
	return {
		contextTokens: limit?.context ?? null,
		maxOutputTokens: limit?.output ?? null,
		price: cost
			? {
					input: cost.input,
					output: cost.output,
					cacheRead: cost.cache_read ?? cost.input,
					cacheWrite: cost.cache_write ?? cost.input,
				}
			: null,
	};
}

/** Model names that can call tools, for the form's suggestions. */
export async function suggestModels(id: ProviderId, fetcher = fetch) {
	return Object.entries(modelsOf(await load(fetcher), id))
		.filter(([, entry]) => model.safeParse(entry).data?.tool_call === true)
		.map(([name]) => name)
		.sort();
}

export type OwnUsage = {
	inputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
};

/** An estimate in millionths of a dollar. A dollar price per million tokens is that per token. */
export function priceUsage(price: ModelPrice, usage: OwnUsage) {
	const read = Math.min(usage.cacheReadTokens, usage.inputTokens);
	const write = Math.min(usage.cacheWriteTokens, usage.inputTokens - read);
	return Math.round(
		(usage.inputTokens - read - write) * price.input +
			read * price.cacheRead +
			write * price.cacheWrite +
			usage.outputTokens * price.output,
	);
}
