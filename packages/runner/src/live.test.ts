import type { RunLive } from "@nullfuse/db";
import { describe, expect, it } from "vitest";
import { liveWriter } from "./live";
import { redactor } from "./redact";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("liveWriter", () => {
	it("saves collected output a few times, not once per piece", async () => {
		const saved: RunLive[] = [];
		const writer = liveWriter({ save: async (live) => void saved.push(live), clean: (t) => t, everyMs: 20 });

		for (const piece of ["a", "b", "c"]) writer.add({ kind: "reasoning", text: piece });
		writer.add({ kind: "tool", name: "edit" });
		await wait(60);

		expect(saved).toEqual([{ stepIndex: 0, reasoning: "abc", text: "", tool: "edit" }]);
	});

	it("starts clean for the next step and saves nothing stale", async () => {
		const saved: RunLive[] = [];
		const writer = liveWriter({ save: async (live) => void saved.push(live), clean: (t) => t, everyMs: 20 });

		writer.add({ kind: "text", text: "old" });
		await writer.next(1);
		await wait(40);
		expect(saved).toEqual([]);

		writer.add({ kind: "text", text: "new" });
		await wait(40);
		expect(saved).toEqual([{ stepIndex: 1, reasoning: "", text: "new", tool: null }]);
	});

	it("keeps going when saving fails", async () => {
		let calls = 0;
		const writer = liveWriter({
			save: async () => {
				calls++;
				throw new Error("database is away");
			},
			clean: (t) => t,
			everyMs: 10,
		});
		writer.add({ kind: "text", text: "a" });
		await wait(30);
		writer.add({ kind: "text", text: "b" });
		await wait(30);
		expect(calls).toBe(2);
	});

	it("never shows a secret, even one that has only half arrived", async () => {
		const secret = "sk-very-secret-value";
		const saved: RunLive[] = [];
		const writer = liveWriter({
			save: async (live) => void saved.push(live),
			clean: redactor([secret]).partial,
			everyMs: 5,
		});

		const output = `The key is ${secret} and that is all, with some more words after it.`;
		for (const character of output) {
			writer.add({ kind: "text", text: character });
			await wait(1);
		}
		await wait(20);

		expect(saved.length).toBeGreaterThan(3);
		for (const live of saved) expect(live.text).not.toContain("sk-v");
		expect(saved.at(-1)?.text).toContain("The key is [hidden] and that is all");
	});
});
