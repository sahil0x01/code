import { generateText, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { lookupModel, priceUsage, suggestModels } from "./catalog";
import { checkModel } from "./check";
import { callSettings, createUserModel, type ModelConfig } from "./model";
import { PROVIDERS, parseOwnModelKey } from "./providers";

const KEY = "sk-test-secret-123456";

const replies = {
	openai: {
		id: "r", created_at: 0, model: "m", status: "completed",
		output: [{ type: "function_call", id: "f", call_id: "c", name: "ping", arguments: '{"ok":true}' }],
		usage: { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 60 } },
	},
	anthropic: {
		id: "m", type: "message", role: "assistant", model: "m", stop_reason: "tool_use", stop_sequence: null,
		content: [{ type: "tool_use", id: "c", name: "ping", input: { ok: true } }],
		usage: { input_tokens: 40, output_tokens: 10, cache_read_input_tokens: 60, cache_creation_input_tokens: 0 },
	},
	google: {
		candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ functionCall: { name: "ping", args: { ok: true } } }] } }],
		usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, totalTokenCount: 110, cachedContentTokenCount: 60 },
	},
	chat: {
		id: "c", created: 0, model: "m",
		choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "", tool_calls: [{ id: "c", type: "function", function: { name: "ping", arguments: '{"ok":true}' } }] } }],
		usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_cache_hit_tokens: 60, prompt_tokens_details: { cached_tokens: 60 } },
	},
};

function server(body: unknown, status = 200) {
	const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
	const fetcher = (async (url: string | URL, init: RequestInit) => {
		seen.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(String(init.body)) });
		return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
	}) as typeof fetch;
	return { seen, fetcher };
}

const cases = [
	{ provider: "openai", reply: replies.openai, url: "https://api.openai.com/v1/responses", header: ["authorization", `Bearer ${KEY}`] },
	{ provider: "anthropic", reply: replies.anthropic, url: "https://api.anthropic.com/v1/messages", header: ["x-api-key", KEY] },
	{ provider: "google", reply: replies.google, url: "https://generativelanguage.googleapis.com/v1beta/models/m:generateContent", header: ["x-goog-api-key", KEY] },
	{ provider: "deepseek", reply: replies.chat, url: "https://api.deepseek.com/chat/completions", header: ["authorization", `Bearer ${KEY}`] },
	{ provider: "openai-compatible", reply: replies.chat, url: "https://llm.example.com/v1/chat/completions", header: ["authorization", `Bearer ${KEY}`] },
] as const;

const config = (provider: ModelConfig["provider"]): ModelConfig => ({
	provider, modelId: "m", apiKey: KEY, baseUrl: provider === "openai-compatible" ? "https://llm.example.com/v1" : null,
});

describe("providers", () => {
	it("covers every provider the form offers", () => {
		expect(cases.map((c) => c.provider)).toEqual(PROVIDERS.map((p) => p.id));
	});

	it.each(cases)("$provider sends the user's key to the right place and reads the usage", async ({ provider, reply, url, header }) => {
		const { seen, fetcher } = server(reply);
		const result = await generateText({
			model: createUserModel(config(provider), { fetch: fetcher }),
			...callSettings(provider, "high"),
			prompt: "hello",
			tools: { ping: tool({ inputSchema: z.object({ ok: z.boolean() }) }) },
		});
		expect(seen[0]?.url).toBe(url);
		expect(seen[0]?.headers.get(header[0])).toBe(header[1]);
		expect(result.toolCalls[0]).toMatchObject({ toolName: "ping", input: { ok: true } });
		expect(result.usage).toMatchObject({ inputTokens: 100, outputTokens: 10 });
		expect(result.usage.inputTokenDetails.cacheReadTokens).toBe(60);
	});

	it.each(cases)("$provider passes the connection check", async ({ provider, reply }) => {
		expect(await checkModel(config(provider), { fetch: server(reply).fetcher })).toEqual({ ok: true });
	});

	it("asks Anthropic to cache the conversation", async () => {
		const { seen, fetcher } = server(replies.anthropic);
		await generateText({
			model: createUserModel(config("anthropic"), { fetch: fetcher }),
			...callSettings("anthropic", "high"),
			prompt: "hello",
		});
		expect(seen[0]?.body.cache_control).toEqual({ type: "ephemeral" });
	});

	it("tells OpenAI not to keep the conversation", async () => {
		const { seen, fetcher } = server(replies.openai);
		await generateText({
			model: createUserModel(config("openai"), { fetch: fetcher }),
			...callSettings("openai", "high"),
			prompt: "hello",
		});
		expect(seen[0]?.body.store).toBe(false);
	});

	it("never falls back to a key from the environment", () => {
		expect(() => createUserModel({ ...config("openai"), apiKey: "" })).toThrow("empty");
	});
});

describe("checkModel errors", () => {
	const failing = (status: number, message: string) =>
		checkModel(config("openai-compatible"), { fetch: server({ error: { message } }, status).fetcher });

	it.each([
		[401, "rejected the API key"],
		[402, "out of credit"],
		[429, "rate limit"],
		[404, "does not know this model"],
		[503, "had a problem"],
	])("explains status %i", async (status, words) => {
		const result = await failing(status, `bad ${KEY}`);
		expect(result).toMatchObject({ ok: false });
		expect(JSON.stringify(result)).toContain(words);
		expect(JSON.stringify(result)).not.toContain(KEY);
	});

	it("recognises a bad key reported with another status", async () => {
		expect(JSON.stringify(await failing(400, "API key not valid. Please pass a valid API key."))).toContain("rejected");
	});

	it("hides the key in a provider's own words", async () => {
		expect(JSON.stringify(await failing(400, `no such thing for ${KEY}`))).not.toContain(KEY);
	});

	it("refuses a model that cannot use tools", async () => {
		const reply = { ...replies.chat, choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "hi" } }] };
		const result = await checkModel(config("openai-compatible"), { fetch: server(reply).fetcher });
		expect(JSON.stringify(result)).toContain("tool calling");
	});
});

describe("catalog", () => {
	const fetcher = (async () =>
		new Response(JSON.stringify({
			anthropic: { models: {
				good: { tool_call: true, limit: { context: 200_000 }, cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } },
				plain: { tool_call: false },
			} },
		}))) as typeof fetch;

	it("finds prices, suggests only tool models, and assumes nothing about own addresses", async () => {
		expect(await lookupModel("anthropic", "good", fetcher)).toEqual({
			contextTokens: 200_000, maxOutputTokens: null, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
		});
		expect(await suggestModels("anthropic", fetcher)).toEqual(["good"]);
		expect(await lookupModel("openai-compatible", "good", fetcher)).toEqual({ contextTokens: null, maxOutputTokens: null, price: null });
		expect(await lookupModel("anthropic", "__proto__", fetcher)).toEqual({ contextTokens: null, maxOutputTokens: null, price: null });
	});

	it("prices cached and uncached tokens apart", () => {
		const price = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
		expect(priceUsage(price, { inputTokens: 1000, cacheReadTokens: 600, cacheWriteTokens: 100, outputTokens: 200 })).toBe(
			300 * 3 + 600 * 0.3 + 100 * 3.75 + 200 * 15,
		);
	});
});

describe("parseOwnModelKey", () => {
	it("accepts only a well formed name", () => {
		expect(parseOwnModelKey("own:3f2b8c1e-1111-4222-8333-123456789abc")).toBe("3f2b8c1e-1111-4222-8333-123456789abc");
		expect(parseOwnModelKey("own:nope")).toBeNull();
		expect(parseOwnModelKey("deepseek-flash")).toBeNull();
	});
});
