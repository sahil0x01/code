import { describe, expect, it } from "vitest";
import { detectSetup } from "./detect";

const pkg = (value: object) => JSON.stringify(value);

describe("detectSetup", () => {
	it("reads a pnpm Next.js app", () => {
		const found = detectSetup(
			["package.json", "pnpm-lock.yaml"],
			pkg({ scripts: { dev: "next dev", test: "vitest run" }, dependencies: { next: "1" } }),
		);
		expect(found).toEqual({
			installCommand: "pnpm install --frozen-lockfile",
			testCommand: "pnpm test",
			startCommand: "pnpm run dev",
			appPort: "3000",
		});
	});

	it("prefers a port written in the script", () => {
		const found = detectSetup(
			["package.json", "package-lock.json"],
			pkg({ scripts: { start: "serve -l 8080 ." }, dependencies: { serve: "1" } }),
		);
		expect(found).toMatchObject({ installCommand: "npm ci", startCommand: "npm run start", appPort: "8080" });
	});

	it("leaves out the placeholder test and an app whose port is unknown", () => {
		const found = detectSetup(
			["package.json"],
			pkg({ scripts: { test: 'echo "Error: no test specified" && exit 1', start: "node bot.js" } }),
		);
		expect(found).toEqual({ installCommand: "", testCommand: "", startCommand: "", appPort: "" });
	});

	it("serves a plain static site, and suggests nothing for the unknown", () => {
		expect(detectSetup(["index.html"], null)).toMatchObject({ appPort: "3000" });
		expect(detectSetup(["main.py"], null).startCommand).toBe("");
		expect(detectSetup(["package.json"], "not json").installCommand).toBe("");
	});
});
