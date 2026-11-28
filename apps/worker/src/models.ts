import { DEEPSEEK_MODEL_IDS, type DeepSeekModelId } from "@nullfuse/agent";
import { type Db, getUserModelSecret } from "@nullfuse/db";
import {
	callSettings,
	checkBaseUrl,
	createUserModel,
	explainModelError,
	lookupModel,
	ownInputs,
	parseOwnModelKey,
	priceUsage,
} from "@nullfuse/models";
import type { RunnerDeps } from "@nullfuse/runner";
import { decryptModelKey } from "@nullfuse/secrets";

// The names the chat offers (apps/web/src/lib/chat.ts) are DeepSeek's own model ids.
export function deepseekModelId(modelKey: string): DeepSeekModelId {
	const id = DEEPSEEK_MODEL_IDS.find((known) => known === modelKey);
	if (!id) throw new Error(`Unknown model: ${modelKey}`);
	return id;
}

/** Loads a user's model for one run and decrypts its key. */
export function ownModels(db: Db, key: Buffer, allowPrivate: boolean): NonNullable<RunnerDeps["ownModel"]> {
	return async ({ userId, modelKey, reasoning }) => {
		const id = parseOwnModelKey(modelKey);
		const row = id ? await getUserModelSecret(db, userId, id) : null;
		if (!row) throw new Error("The model this message used was removed. Pick another and send it again.");
		const apiKey = decryptModelKey(key, row, row.keyEncrypted);
		if (row.baseUrl) await checkBaseUrl(row.baseUrl, { allowPrivate });
		const { price } = row;
		const { inputs } = await lookupModel(row.provider, row.modelId);
		return {
			inputs: ownInputs(row.provider, row.modelId, inputs, row.readsImages),
			apiKey,
			model: createUserModel({ ...row, apiKey }, { allowPrivate }),
			settings: callSettings(row.provider, reasoning, row.maxOutputTokens),
			cost: ({ usage }) =>
				price
					? priceUsage(price, {
							inputTokens: usage.inputTokens ?? 0,
							cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
							cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
							outputTokens: usage.outputTokens ?? 0,
						})
					: 0,
			maxTokens: row.maxRunTokens ?? undefined,
			contextTokens: row.contextTokens ?? undefined,
			explain: (error) => explainModelError(error, apiKey),
		};
	};
}
