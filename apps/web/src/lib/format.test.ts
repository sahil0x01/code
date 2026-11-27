import { describe, expect, it } from "vitest";
import { formatCost } from "./format";

describe("formatCost", () => {
	it("keeps small costs readable", () => {
		expect([400, 12_345, 999_000, 2_345_678].map(formatCost)).toEqual(["<$0.001", "$0.012", "$0.999", "$2.35"]);
	});
});
