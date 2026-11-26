import { describe, expect, it, vi } from "vitest";
import { handleVideo, type VideoDeps } from "./video-handler";

const input = {
	userId: "user-1",
	chatId: "7d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d",
	runId: "8d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d",
};
const recorded = {
	status: "recorded" as const,
	key: "recordings/a.webm",
	passed: true,
	error: null,
	durationMs: 1,
	bytes: 1,
};
const deps = (found: Awaited<ReturnType<VideoDeps["getRecording"]>>) => ({
	getRecording: vi.fn<VideoDeps["getRecording"]>(async () => found),
	downloadUrl: vi.fn(async (key: string) => `https://store.test/${key}?sig=1`),
});

describe("handleVideo", () => {
	it("redirects the owner to a short-lived link", async () => {
		const fake = deps(recorded);
		const response = await handleVideo(fake, input);
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe("https://store.test/recordings/a.webm?sig=1");
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(fake.getRecording).toHaveBeenCalledWith("user-1", input.chatId, input.runId);
	});

	it("sends visitors to sign in without looking anything up", async () => {
		const fake = deps(recorded);
		const response = await handleVideo(fake, { ...input, userId: undefined });
		expect(response.headers.get("Location")).toBe("/sign-in");
		expect(fake.getRecording).not.toHaveBeenCalled();
	});

	it("never signs a link for someone else's run, a skipped one or a bad id", async () => {
		for (const [found, request] of [
			[null, input],
			[{ status: "skipped", message: "no", detail: "" }, input],
			[recorded, { ...input, runId: "nope" }],
		] as const) {
			const fake = deps(found);
			expect((await handleVideo(fake, request)).status).toBe(404);
			expect(fake.downloadUrl).not.toHaveBeenCalled();
		}
	});

	it("says when storage is not set up", async () => {
		expect((await handleVideo({ ...deps(recorded), downloadUrl: null }, input)).status).toBe(503);
	});
});
