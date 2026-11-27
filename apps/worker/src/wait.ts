import type { ExecuteResult } from "@nullfuse/runner";

export const RETRY_SECONDS = 10;
// About an hour. After that the sweeper sends the run again.
const MAX_TRIES = 360;

type Reason = Extract<ExecuteResult, { claimed: false }>["reason"];

// These clear up on their own. The others mean there is nothing left to start.
const WAITING: Reason[] = ["busy", "not_next", "user_busy", "waiting_turn", "no_capacity"];

/** Tries to start a run until it can, pausing in between. */
export async function runWhenThereIsRoom(
	execute: () => Promise<ExecuteResult>,
	pause: () => Promise<unknown>,
	maxTries = MAX_TRIES,
) {
	for (let tries = 1; ; tries++) {
		const result = await execute();
		if (result.claimed || !WAITING.includes(result.reason) || tries >= maxTries) return result;
		await pause();
	}
}
