import { describe, expect, it } from "vitest";
import { nextReveal } from "./reveal";

describe("nextReveal", () => {
	it("moves towards the target, faster when far behind, and then stays", () => {
		expect(nextReveal("", "hello")).toBe("h");
		expect(nextReveal("", "x".repeat(120))).toHaveLength(10);
		expect(nextReveal("hello", "hello")).toBe("hello");
	});

	it("carries on when the start of the live text was cut away", () => {
		const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
		const shown = long.slice(0, 150);
		const next = nextReveal(shown, long.slice(30));
		expect(next.length).toBeGreaterThan(120);
		expect(long.slice(30).startsWith(next)).toBe(true);
	});

	it("jumps to text it cannot match", () => {
		expect(nextReveal("old words", "new")).toBe("new");
	});
});
