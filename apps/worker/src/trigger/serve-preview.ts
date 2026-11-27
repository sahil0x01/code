import { servePreview } from "@nullfuse/runner";
import { task, wait } from "@trigger.dev/sdk";
import { getDeps } from "../deps";

const CHECK_SECONDS = 20;

export const servePreviewTask = task({
	id: "serve-preview",
	// Covers installing and starting. The waits in between are not counted.
	maxDuration: 30 * 60,
	retry: { maxAttempts: 1 },
	run: async (payload: { chatId: string; generation: string }) => {
		await servePreview(await getDeps(), payload.chatId, payload.generation, {
			pause: () => wait.for({ seconds: CHECK_SECONDS }),
		});
	},
});
