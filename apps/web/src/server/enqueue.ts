import "server-only";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { env } from "@/env";

// Starting the run must never fail the user's message: it is already saved and
// queued, so if this fails the run just stays queued.
export async function enqueueRun(input: { runId: string; chatId: string }) {
	if (!env.TRIGGER_SECRET_KEY) return;

	try {
		await tasks.trigger(
			"run-agent",
			{ runId: input.runId },
			{
				idempotencyKey: await idempotencyKeys.create(input.runId, { scope: "global" }),
				concurrencyKey: input.chatId,
			},
		);
	} catch (error) {
		console.error("enqueue run failed", error);
	}
}
