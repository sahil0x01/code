import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { headAndTail, pluralize, shellQuote } from "./shell";
import { ToolError } from "./errors";

function viaShell(value: string) {
	return execFileSync("sh", ["-c", `printf %s ${shellQuote(value)}`], {
		encoding: "utf8",
	});
}

describe("shellQuote", () => {
	it.each([
		"plain",
		"with space",
		"it's",
		'say "hi"',
		"$(touch /tmp/pwned)",
		"`id`",
		"a; rm -rf ~",
		"line1\nline2",
		"-e",
		"*.ts",
		"back\\slash",
		"",
	])("hands %j to the shell as one literal word", (value) => {
		expect(viaShell(value)).toBe(value);
	});

	it("rejects a NUL character", () => {
		expect(() => shellQuote("a\0b")).toThrow(ToolError);
	});
});

describe("headAndTail", () => {
	it("leaves short text alone", () => {
		expect(headAndTail("short", 100)).toBe("short");
	});

	it("keeps the start and the end and says how much was dropped", () => {
		const text = `START${"x".repeat(1000)}END`;
		const result = headAndTail(text, 100);
		expect(result.startsWith("START")).toBe(true);
		expect(result.endsWith("END")).toBe(true);
		expect(result).toContain("[... 908 characters omitted ...]");
	});

	it("gives the tail the larger share by default", () => {
		const result = headAndTail("a".repeat(500) + "b".repeat(500), 90);
		const [head, tail] = result.split(/\n\[\.\.\. \d+ characters omitted \.\.\.\]\n/);
		expect(head?.length).toBe(30);
		expect(tail?.length).toBe(60);
	});
});

describe("pluralize", () => {
	it("uses the singular only for one", () => {
		expect(pluralize(1, "line")).toBe("1 line");
		expect(pluralize(0, "line")).toBe("0 lines");
		expect(pluralize(2, "line")).toBe("2 lines");
	});
});
