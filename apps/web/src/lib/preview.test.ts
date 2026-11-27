import { describe, expect, it } from "vitest";
import { previewView } from "./preview";

const now = Date.parse("2026-01-01T12:00:00Z");
const ready = {
	status: "ready" as const,
	url: "https://3000-token.example.test",
	error: null,
	expiresAt: new Date(now + 60_000),
	updatedAt: new Date(now),
};

describe("previewView", () => {
	it("gives the address of a live preview", () => {
		expect(previewView(ready, now)).toMatchObject({ status: "ready", url: ready.url });
	});

	it("hides the address once it expired or the worker went quiet", () => {
		const expired = { ...ready, expiresAt: new Date(now - 1) };
		const silent = { ...ready, updatedAt: new Date(now - 5 * 60_000) };
		for (const row of [expired, silent]) {
			expect(previewView(row, now)).toMatchObject({ status: "stopped", url: null });
		}
	});

	it("never hands out an address that is not https", () => {
		expect(previewView({ ...ready, url: "javascript:alert(1)" }, now).url).toBeNull();
	});

	it("says when there is none", () => {
		expect(previewView(null, now).status).toBe("none");
	});
});
