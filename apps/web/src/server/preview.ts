import "server-only";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { env } from "@/env";

/** False when no worker could be asked to start it. */
export async function enqueuePreview(input: { chatId: string; generation: string }) {
	if (!env.TRIGGER_SECRET_KEY) return false;

	try {
		await tasks.trigger("serve-preview", input, {
			idempotencyKey: await idempotencyKeys.create(input.generation, { scope: "global" }),
		});
		return true;
	} catch (error) {
		console.error("enqueue preview failed", error);
		return false;
	}
}
