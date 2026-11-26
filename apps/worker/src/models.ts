import { DEEPSEEK_MODEL_IDS, type DeepSeekModelId } from "@nullfuse/agent";

// The names the chat offers (apps/web/src/lib/chat.ts) are DeepSeek's own model ids.
export function deepseekModelId(modelKey: string): DeepSeekModelId {
	const id = DEEPSEEK_MODEL_IDS.find((known) => known === modelKey);
	if (!id) throw new Error(`Unknown model: ${modelKey}`);
	return id;
}
