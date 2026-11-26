import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff";
import { highlightHunks, languageFor } from "./highlight";

describe("languageFor", () => {
	it("reads extensions and well known file names", () => {
		expect(languageFor("src/app.ts")).toBe("typescript");
		expect(languageFor("web/page.TSX")).toBe("tsx");
		expect(languageFor("deploy/Dockerfile")).toBe("docker");
		expect(languageFor("main.py")).toBe("python");
		expect(languageFor("LICENSE")).toBeNull();
		expect(languageFor("photo.unknownext")).toBeNull();
	});
});

describe("highlightHunks", () => {
	it("colours every line without changing its text", async () => {
		const hunks = parsePatch('@@ -1,2 +1,2 @@\n const a = 1;\n-const b = "old";\n+const b = "new";');
		const tokens = await highlightHunks("a.ts", hunks);
		for (const line of hunks[0]?.lines ?? []) {
			const parts = tokens?.get(line) ?? [];
			expect(parts.map((part) => part.text).join("")).toBe(line.text);
			expect(parts[0]?.style).toHaveProperty("--shiki-light");
			expect(parts[0]?.style).toHaveProperty("--shiki-dark");
		}
	});

	it("leaves unknown, very long and very large files plain", async () => {
		const small = parsePatch("@@ -0,0 +1 @@\n+x");
		expect(await highlightHunks("notes.unknownext", small)).toBeNull();
		expect(await highlightHunks("a.js", parsePatch(`@@ -0,0 +1 @@\n+${"x".repeat(2000)}`))).toBeNull();
		const large = `@@ -0,0 +1,4000 @@\n${Array(4000).fill("+x").join("\n")}`;
		expect(await highlightHunks("a.js", parsePatch(large))).toBeNull();
	});
});
