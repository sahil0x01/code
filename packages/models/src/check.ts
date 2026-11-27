import { generateText, tool } from "ai";
import { z } from "zod";
import { explainModelError } from "./errors";
import { callSettings, createUserModel, type ModelConfig, type ModelOptions } from "./model";

export type CheckResult = { ok: true } | { ok: false; message: string };

/** One small call that proves the key works and the model can use tools. */
export async function checkModel(config: ModelConfig, options: ModelOptions = {}): Promise<CheckResult> {
	try {
		const result = await generateText({
			model: createUserModel(config, options),
			providerOptions: callSettings(config.provider, "low").providerOptions,
			prompt: "Call the ping tool now, with ok set to true. Do not reply with text.",
			tools: { ping: tool({ description: "Confirms the connection.", inputSchema: z.object({ ok: z.boolean() }) }) },
			maxOutputTokens: 4000,
			maxRetries: 0,
			abortSignal: AbortSignal.timeout(45_000),
		});
		if (result.toolCalls.some((call) => call.toolName === "ping")) return { ok: true };
		return { ok: false, message: "The model answered but did not call a tool. The agent needs tool calling." };
	} catch (error) {
		return { ok: false, message: explainModelError(error, config.apiKey) };
	}
}
