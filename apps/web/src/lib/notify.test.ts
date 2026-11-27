import { describe, expect, it } from "vitest";
import { type InboxResponse, inboxSignature, newlyFinished } from "./notify";

const inbox = (overrides: Partial<InboxResponse> = {}): InboxResponse => ({
	queued: 0,
	running: 0,
	needsReview: 0,
	unread: 0,
	finished: [
		{ runId: "b", chatId: "2", title: "Two", status: "failed" },
		{ runId: "a", chatId: "1", title: "One", status: "succeeded" },
	],
	preferences: { notifyRunFinished: true, notifyRunFailed: true },
	...overrides,
});
const ids = (runs: { runId: string }[]) => runs.map((run) => run.runId);

describe("newlyFinished", () => {
	it("returns only runs not seen before", () => {
		expect(ids(newlyFinished(new Set(["a"]), inbox()))).toEqual(["b"]);
		expect(newlyFinished(new Set(["a", "b"]), inbox())).toEqual([]);
	});

	it("follows the user's preference for each outcome", () => {
		const quietFailures = inbox({ preferences: { notifyRunFinished: true, notifyRunFailed: false } });
		const quietSuccess = inbox({ preferences: { notifyRunFinished: false, notifyRunFailed: true } });
		expect(ids(newlyFinished(new Set(), quietFailures))).toEqual(["a"]);
		expect(ids(newlyFinished(new Set(), quietSuccess))).toEqual(["b"]);
	});
});

describe("inboxSignature", () => {
	it("changes when a queued run starts, and not otherwise", () => {
		const before = inbox({ queued: 1 });
		expect(inboxSignature(inbox({ queued: 1 }))).toBe(inboxSignature(before));
		expect(inboxSignature(inbox({ running: 1 }))).not.toBe(inboxSignature(before));
	});
});
