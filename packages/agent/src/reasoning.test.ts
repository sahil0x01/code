import { createDeepSeek } from "@ai-sdk/deepseek";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import { DEEPSEEK_MODEL_IDS, REASONING_LEVELS, type ReasoningLevel, reasoningOptions } from "./model";

// Captures what would be sent to DeepSeek, without calling it.
async function send(modelId: string, level: ReasoningLevel) {
	let body: Record<string, unknown> = {};
	const provider = createDeepSeek({
		apiKey: "test",
		fetch: (async (_url: string, init: { body: string }) => {
			body = JSON.parse(init.body);
			return new Response(
				JSON.stringify({
					id: "1",
					created: 0,
					model: modelId,
					choices: [
						{
							index: 0,
							finish_reason: "stop",
							message: { role: "assistant", content: "ok", reasoning_content: "because" },
						},
					],
					usage: {
						prompt_tokens: 10,
						completion_tokens: 5,
						total_tokens: 15,
						prompt_cache_hit_tokens: 4,
						completion_tokens_details: { reasoning_tokens: 3 },
					},
				}),
				{ headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch,
	});
	const result = await generateText({
		model: provider.chat(modelId),
		prompt: "hi",
		providerOptions: reasoningOptions(level),
	});
	return { body, result };
}

describe.each(DEEPSEEK_MODEL_IDS)("reasoning on %s", (modelId) => {
	it.each(REASONING_LEVELS)("sends the %s setting", async (level) => {
		const { body } = await send(modelId, level);
		if (level === "off") {
			expect(body.thinking).toEqual({ type: "disabled" });
			expect(body.reasoning_effort).toBeUndefined();
		} else {
			expect(body.thinking).toEqual({ type: "enabled" });
			expect(body.reasoning_effort).toBe(level);
		}
	});

	it("reports the thinking and the token breakdown", async () => {
		const { result } = await send(modelId, "high");
		expect(result.reasoningText).toBe("because");
		expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(4);
		expect(result.usage.outputTokenDetails.reasoningTokens).toBe(3);
	});
});
