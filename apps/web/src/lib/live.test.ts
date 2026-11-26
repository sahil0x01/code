import { describe, expect, it, vi } from "vitest";
import { handleLive, type LiveDeps, type LiveRow } from "./live-handler";

const input = {
	userId: "user-1",
	chatId: "7d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d",
	runId: "8d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d",
};
const running = (text: string): LiveRow => ({
	status: "running",
	live: { stepIndex: 0, reasoning: "", text, tool: null },
});
const deps = (...rows: (LiveRow | null)[]) => ({
	getLive: vi.fn<LiveDeps["getLive"]>(async () => (rows.length > 1 ? (rows.shift() ?? null) : (rows[0] ?? null))),
	everyMs: 1,
});
const open = (fake: LiveDeps, overrides: Partial<Parameters<typeof handleLive>[1]> = {}) =>
	handleLive(fake, { ...input, signal: new AbortController().signal, ...overrides });

describe("handleLive", () => {
	it("sends each change once, then done when the run finishes", async () => {
		const response = await open(
			deps(running("He"), running("He"), running("Hello"), { status: "succeeded", live: null }),
		);
		const body = await response.text();

		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(body.match(/event: live/g)).toHaveLength(2);
		expect(body).toContain('"text":"Hello"');
		expect(body.trim().endsWith("event: done\ndata: {}")).toBe(true);
	});

	it("ends without done after its time limit, so the browser reconnects", async () => {
		const body = await (await open({ ...deps(running("x")), maxMs: 20 })).text();
		expect(body).toContain("event: live");
		expect(body).not.toContain("event: done");
	});

	it("stops reading the database when the browser leaves", async () => {
		const fake = deps(running("x"));
		const leave = new AbortController();
		const response = await open(fake, { signal: leave.signal });
		setTimeout(() => leave.abort(), 20);
		await response.text();
		const calls = fake.getLive.mock.calls.length;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(fake.getLive.mock.calls.length).toBe(calls);
	});

	it("refuses visitors, strangers and bad ids", async () => {
		const stranger = deps(null);
		expect((await open(stranger, { userId: undefined })).status).toBe(401);
		expect(stranger.getLive).not.toHaveBeenCalled();
		expect((await open(stranger)).status).toBe(404);
		expect((await open(deps(running("x")), { runId: "nope" })).status).toBe(404);
	});
});
