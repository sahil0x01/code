import { commandOptions, parseMentions, parseMessage } from "@nullfuse/agent/commands";
import { describe, expect, it } from "vitest";
import { activeToken, applySuggestion, suggestCommands, suggestFiles } from "./suggest";

const at = (text: string) => activeToken(text, text.length);

describe("suggestCommands", () => {
	it("offers /merge only when there is a pull request", () => {
		expect(suggestCommands([], "mer", true).map((entry) => entry.value)).toEqual(["/merge"]);
		expect(suggestCommands([], "mer")).toEqual([]);
	});
});

describe("activeToken", () => {
	it("finds a command only at the start of a message", () => {
		expect(at("/pl")).toEqual({ kind: "command", query: "pl", start: 0 });
		expect(at("/plan /te")).toEqual({ kind: "command", query: "te", start: 6 });
		expect(at("look in /usr")).toBeNull();
		expect(at("/plan fix it")).toBeNull();
		expect(at("/usr/bin")).toBeNull();
	});

	it("finds a mention anywhere after a space, but not in an email address", () => {
		expect(at("fix @src/ut")).toEqual({ kind: "file", query: "src/ut", start: 4 });
		expect(at("@")).toEqual({ kind: "file", query: "", start: 0 });
		expect(at("mail me@example")).toBeNull();
		expect(activeToken("see @app.js now", 11)?.query).toBe("app.js");
	});
});

describe("suggestions", () => {
	const files = ["docs/readme-extra.md", "src/", "src/composer.tsx", "src/deep/compose.ts", "package.json"];

	it("puts names that start with the query first", () => {
		expect(suggestFiles(files, "compos").map((s) => s.value)).toEqual(["@src/composer.tsx", "@src/deep/compose.ts"]);
		expect(suggestFiles(files, "cmpsr")[0]?.value).toBe("@src/composer.tsx");
		expect(suggestFiles(files, "zzz")).toEqual([]);
	});

	it("offers commands and the repository's skills", () => {
		expect(suggestCommands(["release", "plan"], "re").map((s) => s.value)).toEqual(["/review", "/release"]);
		expect(suggestCommands(["release", "plan"], "plan")).toHaveLength(1);
	});

	it("replaces what was typed and keeps the rest", () => {
		expect(applySuggestion("fix @co now", { kind: "file", query: "co", start: 4 }, 7, "@src/composer.tsx")).toEqual({
			text: "fix @src/composer.tsx now",
			caret: 22,
		});
	});
});

describe("commands in a message", () => {
	it("turns on the matching options", () => {
		expect(commandOptions("/plan /test add dark mode")).toEqual({ planOnly: true, verify: true, missingTask: false });
		expect(commandOptions("/plan").missingTask).toBe(true);
		expect(commandOptions("/init").missingTask).toBe(false);
		expect(commandOptions("what does /plan do?").planOnly).toBe(false);
	});

	it("stops at the first word that is neither a command nor a skill", () => {
		expect(parseMessage("/release now", ["release"])).toMatchObject({ skills: ["release"], rest: "now" });
		expect(parseMessage("/unknown thing")).toMatchObject({ commands: [], rest: "/unknown thing" });
	});

	it("reads mentions without punctuation, and none that leave the repository", () => {
		expect(parseMentions("see @src/a.ts, (@docs/) and @src/a.ts. not me@x.com @../secret @/etc/passwd")).toEqual([
			"src/a.ts",
			"docs/",
		]);
	});
});
