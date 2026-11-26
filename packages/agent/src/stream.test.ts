import { DockerDriver, dockerAvailable, readText, type Sandbox } from "@nullfuse/sandbox";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AgentDelta, runAgent } from "./agent";
import { withFallback } from "./fallback";
import { answer, asStream, toolCalls } from "./testing";

const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the streaming tests in CI");
}

const messages = [{ role: "user" as const, content: "Write a note" }];

describe.skipIf(!hasDocker)("streamed agent runs", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await new DockerDriver().create({ image: "alpine:3", memoryMb: 256 });
	});
	afterAll(() => sandbox?.destroy());

	const write = () => toolCalls({ name: "write", input: { path: "note.txt", content: "hi" } });

	it("passes on thinking, tool and text pieces, and returns the same result", async () => {
		const model = new MockLanguageModelV4({
			doStream: [asStream(write(), "I will write it"), asStream(answer("Wrote the note."))],
		});
		const seen: AgentDelta[] = [];

		const run = await runAgent({ model, sandbox, messages, onDelta: (delta) => seen.push(delta) });

		expect(run).toMatchObject({ text: "Wrote the note.", stoppedBy: "completed" });
		expect(run.steps).toHaveLength(2);
		expect(run.steps[0]?.reasoningText).toBe("I will write it");
		expect(run.usage.totalTokens).toBe(240);
		const joined = (kind: "reasoning" | "text") =>
			seen.flatMap((delta) => (delta.kind === kind ? [delta.text] : [])).join("");
		expect(joined("reasoning")).toBe("I will write it");
		expect(joined("text")).toBe("Wrote the note.");
		expect(seen).toContainEqual({ kind: "tool", name: "write" });
		expect(await readText(sandbox, "note.txt")).toBe("hi");
	});

	it("finishes saving a step before the model is called again", async () => {
		const order: string[] = [];
		const results = [asStream(write()), asStream(answer("Done."))];
		const model = new MockLanguageModelV4({
			doStream: async () => {
				order.push("model");
				const next = results.shift();
				if (!next) throw new Error("no more answers");
				return next;
			},
		});

		await runAgent({
			model,
			sandbox,
			messages,
			onDelta: () => {},
			onStep: async () => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				order.push("saved");
			},
		});

		expect(order).toEqual(["model", "saved", "model", "saved"]);
	});

	it("stops at the step limit", async () => {
		const model = new MockLanguageModelV4({ doStream: async () => asStream(write()) });
		const run = await runAgent({ model, sandbox, messages, onDelta: () => {}, limits: { maxSteps: 2 } });
		expect(run.stoppedBy).toBe("step-limit");
		expect(run.steps).toHaveLength(2);
	});

	it("reports a stop and a timeout, keeping the finished steps", async () => {
		// The second model call never answers; `reached` runs once it has started.
		const hangs = (reached: () => void = () => {}) => {
			let calls = 0;
			return new MockLanguageModelV4({
				doStream: async ({ abortSignal }) => {
					if (calls++ === 0) return asStream(write());
					return new Promise((_, reject) => {
						abortSignal?.addEventListener("abort", () => reject(abortSignal.reason));
						reached();
					});
				},
			});
		};
		const stop = new AbortController();

		const stopped = await runAgent({
			model: hangs(() => setTimeout(() => stop.abort(), 20)),
			sandbox,
			messages,
			onDelta: () => {},
			signal: stop.signal,
		});
		const slow = await runAgent({
			model: hangs(),
			sandbox,
			messages,
			onDelta: () => {},
			limits: { timeoutMs: 5000 },
		});

		expect(stopped).toMatchObject({ stoppedBy: "aborted" });
		expect(stopped.steps).toHaveLength(1);
		expect(slow).toMatchObject({ stoppedBy: "timeout" });
		expect(slow.steps).toHaveLength(1);
	});

	it("fails the run when the provider reports an error", async () => {
		const model = new MockLanguageModelV4({
			doStream: async () => {
				throw new Error("provider is down");
			},
		});
		await expect(runAgent({ model, sandbox, messages, onDelta: () => {} })).rejects.toThrow("provider is down");
	});

	it("fails the run when the sandbox dies, without calling the model again", async () => {
		const broken = await new DockerDriver().create({ image: "alpine:3", memoryMb: 256 });
		await broken.destroy();
		const model = new MockLanguageModelV4({ doStream: async () => asStream(write()) });

		await expect(runAgent({ model, sandbox: broken, messages, onDelta: () => {} })).rejects.toThrow();
		expect(model.doStreamCalls).toHaveLength(1);
	});

	it("falls back to another model when a stream cannot start", async () => {
		const down = new MockLanguageModelV4({
			doStream: async () => {
				throw new Error("overloaded");
			},
		});
		const spare = new MockLanguageModelV4({ doStream: async () => asStream(answer("From the spare.")) });

		const run = await runAgent({
			model: withFallback(down, [spare]),
			sandbox,
			messages,
			onDelta: () => {},
		});

		expect(run.text).toBe("From the spare.");
	});
});
