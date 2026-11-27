import type { ExecuteResult } from "@nullfuse/runner";
import { describe, expect, it } from "vitest";
import { runWhenThereIsRoom } from "./wait";

const done: ExecuteResult = { claimed: true, status: "succeeded", stopReason: "completed" };

function scripted(...results: ExecuteResult[]) {
	const seen = { tries: 0, pauses: 0 };
	const execute = async () => results[Math.min(seen.tries++, results.length - 1)] as ExecuteResult;
	const pause = async () => void seen.pauses++;
	return { seen, execute, pause };
}

describe("runWhenThereIsRoom", () => {
	it("keeps trying while the run has to wait", async () => {
		const { seen, execute, pause } = scripted(
			{ claimed: false, reason: "no_capacity" },
			{ claimed: false, reason: "waiting_turn" },
			{ claimed: false, reason: "user_busy" },
			done,
		);

		expect(await runWhenThereIsRoom(execute, pause)).toEqual(done);
		expect(seen).toEqual({ tries: 4, pauses: 3 });
	});

	it("stops at once when there is nothing to start", async () => {
		const { seen, execute, pause } = scripted({ claimed: false, reason: "not_queued" });

		expect(await runWhenThereIsRoom(execute, pause)).toEqual({ claimed: false, reason: "not_queued" });
		expect(seen).toEqual({ tries: 1, pauses: 0 });
	});

	it("gives up after the last try", async () => {
		const { seen, execute, pause } = scripted({ claimed: false, reason: "no_capacity" });

		await runWhenThereIsRoom(execute, pause, 3);

		expect(seen).toEqual({ tries: 3, pauses: 2 });
	});
});
