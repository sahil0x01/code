import { describe, expect, it } from "vitest";
import { formatTokens } from "./format";
import { durationSince, relativeTime } from "./time";

describe("formatTokens", () => {
	it("keeps small numbers and shortens large ones", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1234)).toBe("1.2k");
		expect(formatTokens(12_345)).toBe("12k");
		expect(formatTokens(999_999)).toBe("1000k");
		expect(formatTokens(1_500_000)).toBe("1.5M");
	});
});

describe("durationSince", () => {
	const start = new Date("2026-01-01T00:00:00Z");
	const after = (ms: number) => new Date(start.getTime() + ms);

	it("writes seconds, minutes and hours", () => {
		expect(durationSince(start, after(0))).toBe("0s");
		expect(durationSince(start, after(42_000))).toBe("42s");
		expect(durationSince(start, after(185_000))).toBe("3m 5s");
		expect(durationSince(start, after(3_720_000))).toBe("1h 2m");
	});

	it("never goes negative and measures to now without an end", () => {
		expect(durationSince(start, after(-5000))).toBe("0s");
		expect(durationSince(new Date(Date.now() - 5000))).toMatch(/^[4-6]s$/);
		expect(durationSince(new Date(Date.now() - 5000), null)).toMatch(/^[4-6]s$/);
	});
});

describe("relativeTime", () => {
	const now = Date.parse("2026-06-15T12:00:00Z");

	it("says how long ago, in the largest sensible unit", () => {
		expect(relativeTime(new Date(now - 10_000), now)).toBe("just now");
		expect(relativeTime(new Date(now - 5 * 60_000), now)).toBe("5 minutes ago");
		expect(relativeTime(new Date(now - 3 * 3_600_000), now)).toBe("3 hours ago");
		expect(relativeTime(new Date(now - 86_400_000), now)).toBe("yesterday");
	});

	it("uses a date after a month", () => {
		expect(relativeTime(new Date(now - 40 * 86_400_000), now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
	});
});
