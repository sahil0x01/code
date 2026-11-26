import type { EarlierRun } from "@nullfuse/db";
import { describe, expect, it } from "vitest";
import { withEarlierWork, workSummary } from "./memory";

const action = (name: string, target: string, ending = "", isError = false) => ({
	name,
	target,
	ending,
	isError,
});
const past = (request: string, actions: EarlierRun["actions"], status: EarlierRun["status"] = "succeeded") => ({
	id: request,
	request,
	status,
	actions,
});

describe("workSummary", () => {
	it("lists changed and read files and each command's latest result", () => {
		const summary = workSummary([
			past("Add search", [
				action("read", "app.js"),
				action("read", "index.html"),
				action("edit", "app.js"),
				action("bash", "pnpm test", "1 failing\n[exit code: 1]"),
				action("bash", "pnpm test", "all passed"),
				action("bash", "pnpm build", "[timed out after 120s: every process was killed]"),
				action("read", "missing.js", "File not found: missing.js", true),
				action("check_app", "", "No script failure."),
			]),
		]);

		expect(summary).toContain("Request: Add search");
		expect(summary).toContain("Changed: app.js\n");
		expect(summary).toContain("Read: index.html\n");
		expect(summary).toContain("- pnpm test -> ok");
		expect(summary).not.toContain("exit code 1");
		expect(summary).toContain("- pnpm build -> timed out");
		expect(summary).toContain("- check_app (browser check) -> ok");
		expect(summary).not.toContain("missing.js");
	});

	it("says when a run did not finish, and shows why a command failed", () => {
		const summary = workSummary([
			past("Deploy", [action("bash", "make", "boom\n[exit code: 2]")], "failed"),
		]);
		expect(summary).toContain("failed before finishing");
		expect(summary).toContain("- make -> failed, exit code 2");
	});

	it("keeps the newest runs within the size limit", () => {
		const many = Array.from({ length: 30 }, (_, index) =>
			past(`request-${index}`, [action("bash", `echo ${"x".repeat(130)} ${index}`)].concat(
				Array.from({ length: 10 }, (_, file) => action("read", `src/file-${index}-${file}.ts`)),
			)),
		);
		const summary = workSummary(many) ?? "";
		expect(summary.length).toBeLessThan(9000);
		expect(summary).toContain("request-29");
		expect(summary).not.toContain("request-0\n");
	});

	it("has nothing to say without earlier work, and cleans what it says", () => {
		expect(workSummary([])).toBeNull();
		expect(workSummary([past("a", [action("bash", "echo hunter2")])], (text) => text.replaceAll("hunter2", "[hidden]"))).not.toContain("hunter2");
	});
});

describe("withEarlierWork", () => {
	const messages = [
		{ role: "user" as const, content: "first" },
		{ role: "assistant" as const, content: "done" },
		{ role: "user" as const, content: "second" },
	];

	it("adds the record to the message being answered only", () => {
		const result = withEarlierWork(messages, "<earlier_work/>");
		expect(result.map((message) => message.content)).toEqual(["first", "done", "<earlier_work/>\n\nsecond"]);
		expect(messages[2]?.content).toBe("second");
	});

	it("leaves messages alone without a record", () => {
		expect(withEarlierWork(messages, null)).toBe(messages);
	});
});
