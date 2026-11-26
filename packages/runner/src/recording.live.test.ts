import { DaytonaDriver, ensureDaytonaRecordingSnapshot, type Sandbox } from "@nullfuse/sandbox";
import { createR2Store, r2ConfigFrom } from "@nullfuse/storage";
import { afterAll, describe, expect, it } from "vitest";
import { recordChange, uploadRecording } from "./recording";

// Opt in with RUN_RECORDING_LIVE=1, DAYTONA_API_KEY and the R2 values. It uses real,
// billed services: it builds the snapshot if missing and runs one short sandbox.
const apiKey = process.env.RUN_RECORDING_LIVE ? process.env.DAYTONA_API_KEY : undefined;
const r2 = r2ConfigFrom(process.env);

describe.skipIf(!apiKey || !r2)("recording on Daytona", () => {
	let sandbox: Sandbox | undefined;
	afterAll(async () => {
		await sandbox?.destroy();
	});

	it("builds the snapshot, records a static site and uploads the video to R2", async () => {
		if (!apiKey || !r2) return;
		const { client, snapshot } = await ensureDaytonaRecordingSnapshot(apiKey);
		console.log("snapshot ready:", snapshot);
		sandbox = await new DaytonaDriver({ client, snapshot }).create();
		await sandbox.writeFile("index.html", "<h1>Notes</h1>");

		const recording = await recordChange(sandbox, {
			startCommand: "npx --yes serve -l 3000 .",
			port: 3000,
			script: `export default async ({ page, expect }) => {
				await page.goto("/");
				await expect(page.getByRole("heading")).toHaveText("Notes");
			};`,
		});
		console.log("recording:", JSON.stringify(recording));
		expect(recording).toMatchObject({ status: "recorded", passed: true });
		if (recording.status !== "recorded") return;

		const store = createR2Store(r2);
		const key = `recordings/live-test/${Date.now()}.webm`;
		expect(await uploadRecording(sandbox, recording.path, await store.uploadUrl(key))).toBeNull();
		try {
			const video = await (await fetch(await store.downloadUrl(key))).arrayBuffer();
			expect(video.byteLength).toBe(recording.bytes);
		} finally {
			await store.remove(key);
		}
	}, 1_500_000);
});
