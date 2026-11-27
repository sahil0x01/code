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

/**
 * A retried task can find its run still marked running by the attempt that died.
 * Waits until the run is free: its heartbeat has to go stale first.
 */
export async function waitForDeadAttempt(
	recover: () => Promise<boolean>,
	pause: () => Promise<unknown>,
	staleSeconds: number,
) {
	// A few tries past the stale time, so a live attempt is left alone in the end.
	const maxTries = Math.ceil(staleSeconds / RETRY_SECONDS) + 3;
	for (let tries = 1; ; tries++) {
		if (await recover()) return true;
		if (tries >= maxTries) return false;
		await pause();
	}
}
