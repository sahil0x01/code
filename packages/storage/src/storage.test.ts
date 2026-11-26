import { describe, expect, it } from "vitest";
import { createR2Store, r2ConfigFrom, recordingKey } from "./index";

const env = {
	R2_ACCOUNT_ID: "acct",
	R2_BUCKET: "videos",
	R2_ACCESS_KEY_ID: "key-id",
	R2_SECRET_ACCESS_KEY: "very-secret",
};

describe("r2ConfigFrom", () => {
	it("needs all four values", () => {
		expect(r2ConfigFrom(env)).toMatchObject({ bucket: "videos" });
		expect(r2ConfigFrom({ ...env, R2_BUCKET: "" })).toBeNull();
		expect(r2ConfigFrom({})).toBeNull();
	});
});

describe("recordingKey", () => {
	it("keeps each run and attempt apart and strips path characters", () => {
		expect(recordingKey({ userId: "../u", chatId: "c", runId: "r", attempt: 2 })).toBe(
			"recordings/___u/c/r-2.webm",
		);
	});
});

describe("createR2Store", () => {
	const store = createR2Store({
		accountId: "acct",
		bucket: "videos",
		accessKeyId: "key-id",
		secretAccessKey: "very-secret",
	});

	it("signs a short-lived link for one object without exposing the secret", async () => {
		const url = new URL(await store.uploadUrl("recordings/u/c/r-1.webm", 60));
		expect(url.origin).toBe("https://acct.r2.cloudflarestorage.com");
		expect(url.pathname).toBe("/videos/recordings/u/c/r-1.webm");
		expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
		expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
		expect(url.href).not.toContain("very-secret");
	});

	it("signs uploads and downloads differently", async () => {
		const [put, get] = await Promise.all([store.uploadUrl("a"), store.downloadUrl("a")]);
		const signature = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");
		expect(signature(put)).not.toBe(signature(get));
	});
});
