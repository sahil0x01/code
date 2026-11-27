import { describe, expect, it } from "vitest";
import { isPeak, modelCost, priceModel } from "./pricing";

const offPeak = new Date("2026-11-27T12:00:00Z");
const peak = new Date("2026-11-27T07:00:00Z");
const usage = { inputTokens: 1_000_000, cachedInputTokens: 900_000, outputTokens: 100_000 };

describe("modelCost", () => {
	it("prices cached input, new input and output apart", () => {
		// 900k x 0.003 + 100k x 0.15 + 100k x 0.6
		expect(modelCost("deepseek-flash", usage, offPeak)).toBe(77_700);
		// 900k x 0.022 + 100k x 0.66 + 100k x 1.98
		expect(modelCost("deepseek-v4-pro", usage, offPeak)).toBe(283_800);
	});

	it("doubles in peak hours", () => {
		expect(modelCost("deepseek-flash", usage, peak)).toBe(155_400);
	});

	it("knows the weekday peak windows", () => {
		const at = (iso: string) => isPeak(new Date(iso));
		expect([at("2026-11-27T00:59:00Z"), at("2026-11-27T01:00:00Z"), at("2026-11-27T04:00:00Z")]).toEqual([
			false,
			true,
			false,
		]);
		expect([at("2026-11-27T09:59:00Z"), at("2026-11-27T10:00:00Z"), at("2026-11-28T07:00:00Z")]).toEqual([
			true,
			false,
			false,
		]);
	});
});

describe("priceModel", () => {
	it("prices the model that answered, then the one asked for, then the dearest", () => {
		expect(priceModel("deepseek-flash", "deepseek-v4-pro")).toBe("deepseek-flash");
		expect(priceModel(undefined, "deepseek-flash")).toBe("deepseek-flash");
		expect(priceModel("something-else", "unknown")).toBe("deepseek-v4-pro");
	});
});
