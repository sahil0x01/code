import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { withFallback } from "./fallback";
import { answer } from "./testing";

const failing = () =>
	new MockLanguageModelV4({
		doGenerate: async () => {
			throw new Error("provider down");
		},
	});
const working = (text: string) => new MockLanguageModelV4({ doGenerate: async () => answer(text) });

describe("withFallback", () => {
	it("answers from the primary model when it works", async () => {
		const backup = working("backup");
		const model = withFallback(working("primary"), [backup]);
		const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
		expect(result.text).toBe("primary");
		expect(backup.doGenerateCalls).toHaveLength(0);
	});

	it("moves to the next model when the primary fails, and reports it", async () => {
		const seen: unknown[] = [];
		const model = withFallback(failing(), [failing(), working("backup")], (e) => seen.push(e));
		const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
		expect(result.text).toBe("backup");
		expect(seen).toHaveLength(1);
	});

	it("throws the last error when every model fails", async () => {
		const model = withFallback(failing(), [failing()]);
		await expect(generateText({ model, prompt: "hi", maxRetries: 0 })).rejects.toThrow("provider down");
	});

	it("does not fall back when the call was aborted", async () => {
		const backup = working("backup");
		const controller = new AbortController();
		const primary = new MockLanguageModelV4({
			doGenerate: async () => {
				controller.abort();
				throw new Error("aborted");
			},
		});
		const model = withFallback(primary, [backup]);
		await expect(
			generateText({ model, prompt: "hi", maxRetries: 0, abortSignal: controller.signal }),
		).rejects.toThrow();
		expect(backup.doGenerateCalls).toHaveLength(0);
	});
});
