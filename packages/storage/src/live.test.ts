import { describe, expect, it } from "vitest";
import { createR2Store, r2ConfigFrom } from "./index";

// Opt in with RUN_R2_LIVE=1 and the four R2 values in the environment.
const config = process.env.RUN_R2_LIVE ? r2ConfigFrom(process.env) : null;

describe.skipIf(!config)("R2", () => {
	it("uploads, reads back and deletes an object, and refuses it without a signature", async () => {
		if (!config) return;
		const store = createR2Store(config);
		const key = `recordings/live-test/${Date.now()}.webm`;

		const put = await fetch(await store.uploadUrl(key), { method: "PUT", body: "nullfuse" });
		expect(put.status).toBe(200);
		try {
			const download = await store.downloadUrl(key);
			expect(await (await fetch(download)).text()).toBe("nullfuse");
			expect((await fetch(download.split("?")[0] ?? "")).ok).toBe(false);
		} finally {
			await store.remove(key);
		}
		expect((await fetch(await store.downloadUrl(key))).status).toBe(404);
	}, 30_000);
});
