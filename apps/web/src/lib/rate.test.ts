import { describe, expect, it } from "vitest";
import { allowModelCheck } from "./rate";

describe("allowModelCheck", () => {
	it("allows ten a minute for each user", () => {
		for (let n = 0; n < 10; n++) expect(allowModelCheck("a", 1000)).toBe(true);
		expect(allowModelCheck("a", 1000)).toBe(false);
		expect(allowModelCheck("b", 1000)).toBe(true);
		expect(allowModelCheck("a", 62_000)).toBe(true);
	});
});
