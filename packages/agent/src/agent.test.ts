import { DockerDriver, dockerAvailable, readText, type Sandbox, SandboxError } from "@nullfuse/sandbox";
import type { ModelMessage } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgent, SYSTEM_PROMPT, toStepRecord } from "./index";
import { answer, toolCalls, usage } from "./testing";

const IMAGE = process.env.SANDBOX_TEST_IMAGE ?? "alpine:3";

// Skipped locally without Docker; a failure in CI so they cannot silently stop.
const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the agent tests in CI");
}
if (!hasDocker) {
	console.warn("Docker is not running: skipping the agent loop tests");
}

const asks = (text: string): ModelMessage[] => [{ role: "user", content: text }];

// A model call that takes `ms` and, like a real provider, gives up when aborted.
const slow = <T>(ms: number, result: T) => (options: { abortSignal?: AbortSignal }) =>
	new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => resolve(result), ms);
		options.abortSignal?.addEventListener("abort", () => {
			clearTimeout(timer);
			reject(options.abortSignal?.reason);
		});
	});

describe.skipIf(!hasDocker)("runAgent", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await new DockerDriver().create({ image: IMAGE, memoryMb: 512 });
	});

	afterAll(async () => {
		await sandbox?.destroy();
	});

	it("works through tool calls to a final answer", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "loop/hello.txt", content: "hi\n" } }),
				toolCalls({ name: "bash", input: { command: "cat loop/hello.txt" } }),
				answer("Created hello.txt and checked it."),
			],
		});

		const result = await runAgent({ model, sandbox, messages: asks("Make hello.txt") });

		expect(result.stoppedBy).toBe("completed");
		expect(result.text).toBe("Created hello.txt and checked it.");
		expect(result.steps).toHaveLength(3);
		expect(result.usage).toEqual({ inputTokens: 300, outputTokens: 60, totalTokens: 360 });
		expect(await readText(sandbox, "loop/hello.txt")).toBe("hi\n");
		expect(JSON.stringify(result.steps[1]?.toolResults)).toContain("hi");
	});

	it("gives the model the instructions, the conversation and the six tools", async () => {
		const model = new MockLanguageModelV4({ doGenerate: [answer("ok")] });
		await runAgent({
			model,
			sandbox,
			messages: [
				{ role: "user", content: "first question" },
				{ role: "assistant", content: "first answer" },
				{ role: "user", content: "second question" },
			],
		});

		const call = model.doGenerateCalls[0];
		expect(call?.prompt[0]).toMatchObject({ role: "system", content: SYSTEM_PROMPT });
		const prompt = JSON.stringify(call?.prompt);
		expect(prompt).toContain("first answer");
		expect(prompt).toContain("second question");
		expect(call?.tools?.map((tool) => tool.name).sort()).toEqual([
			"bash",
			"edit",
			"grep",
			"list",
			"read",
			"write",
		]);
	});

	it("passes the project's variables to commands", async () => {
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "bash", input: { command: 'printf %s "$PROJECT_KEY"' } }),
				answer("done"),
			],
		});
		const result = await runAgent({
			model,
			sandbox,
			messages: asks("run it"),
			env: { PROJECT_KEY: "from-the-project" },
		});
		expect(JSON.stringify(result.steps[0]?.toolResults)).toContain("from-the-project");
	});

	it("calls onStep after every step, in order", async () => {
		const seen: string[] = [];
		const model = new MockLanguageModelV4({
			doGenerate: [toolCalls({ name: "list", input: {} }), answer("finished")],
		});
		await runAgent({
			model,
			sandbox,
			messages: asks("look around"),
			onStep: (step) => {
				seen.push(step.finishReason);
			},
		});
		expect(seen).toEqual(["tool-calls", "stop"]);
	});

	describe("errors the model can recover from", () => {
		it("shows a tool failure to the model and keeps going", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: [
					toolCalls({ name: "read", input: { path: "no-such-file.txt" } }),
					answer("It does not exist."),
				],
			});
			const result = await runAgent({ model, sandbox, messages: asks("read it") });

			expect(result.stoppedBy).toBe("completed");
			expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain(
				"File not found: no-such-file.txt",
			);
		});

		it("shows invalid tool input to the model instead of crashing", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: [toolCalls({ name: "read", input: { path: 5 } }), answer("sorry")],
			});
			const result = await runAgent({ model, sandbox, messages: asks("read") });

			expect(result.stoppedBy).toBe("completed");
			expect(model.doGenerateCalls).toHaveLength(2);
		});

		it("shows a call to an unknown tool to the model instead of crashing", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: [toolCalls({ name: "teleport", input: {} }), answer("sorry")],
			});
			const result = await runAgent({ model, sandbox, messages: asks("go") });

			expect(result.stoppedBy).toBe("completed");
			expect(model.doGenerateCalls).toHaveLength(2);
		});
	});

	describe("limits", () => {
		it("stops at the step limit and says so", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: async () => toolCalls({ name: "list", input: {} }),
			});
			const result = await runAgent({
				model,
				sandbox,
				messages: asks("loop forever"),
				limits: { maxSteps: 3 },
			});

			expect(result.stoppedBy).toBe("step-limit");
			expect(result.steps).toHaveLength(3);
		});

		it("stops once the token budget is spent and says so", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: async () => ({
					...toolCalls({ name: "list", input: {} }),
					usage: usage(900, 100),
				}),
			});
			const result = await runAgent({
				model,
				sandbox,
				messages: asks("use tokens"),
				limits: { maxTokens: 2500 },
			});

			expect(result.stoppedBy).toBe("token-budget");
			expect(result.steps).toHaveLength(3);
			expect(result.usage.totalTokens).toBe(3000);
		});

		it("returns the steps so far when time runs out", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: async (options) => {
					if (model.doGenerateCalls.length === 1) return toolCalls({ name: "list", input: {} });
					return slow(2000, answer("too late"))(options);
				},
			});
			const result = await runAgent({
				model,
				sandbox,
				messages: asks("take your time"),
				limits: { timeoutMs: 300 },
			});

			expect(result.stoppedBy).toBe("timeout");
			expect(result.steps).toHaveLength(1);
		});

		it("does not start when the caller has already aborted", async () => {
			const model = new MockLanguageModelV4({ doGenerate: [answer("unused")] });
			const result = await runAgent({
				model,
				sandbox,
				messages: asks("too late"),
				signal: AbortSignal.abort(),
			});

			expect(result).toMatchObject({ stoppedBy: "aborted", steps: [], text: "" });
			expect(model.doGenerateCalls).toHaveLength(0);
		});

	it("returns the steps so far when the caller aborts", async () => {
			const controller = new AbortController();
			const model = new MockLanguageModelV4({
				doGenerate: async (options) => {
					if (model.doGenerateCalls.length === 1) return toolCalls({ name: "list", input: {} });
					setTimeout(() => controller.abort(), 100);
					return slow(2000, answer("too late"))(options);
				},
			});
			const result = await runAgent({
				model,
				sandbox,
				messages: asks("stop me"),
				signal: controller.signal,
			});

			expect(result.stoppedBy).toBe("aborted");
			expect(result.steps).toHaveLength(1);
		});
	});

	describe("errors that must stop the run", () => {
		it("fails the run, without another model call, when the sandbox breaks", async () => {
			const broken = Object.create(sandbox, {
				exec: {
					value: async () => {
						throw new SandboxError("the container died");
					},
				},
			}) as Sandbox;
			const model = new MockLanguageModelV4({
				doGenerate: [toolCalls({ name: "list", input: {} }), answer("never reached")],
			});
			const steps: unknown[] = [];

			await expect(
				runAgent({
					model,
					sandbox: broken,
					messages: asks("look"),
					onStep: (step) => {
						steps.push(step);
					},
				}),
			).rejects.toThrow("the container died");

			expect(model.doGenerateCalls).toHaveLength(1);
			expect(steps).toHaveLength(1);
		});
	});

	describe("toStepRecord", () => {
		it("turns steps into what the database stores", async () => {
			const model = new MockLanguageModelV4({
				doGenerate: [
					toolCalls({ name: "write", input: { path: "rec/big.txt", content: "x".repeat(5000) } }),
					toolCalls(
						{ name: "read", input: { path: "no-such-file.txt" } },
						{ name: "read", input: { path: 5 } },
					),
					toolCalls({ name: "bash", input: { command: "seq 1 20000" } }),
					answer("All done."),
				],
			});
			const result = await runAgent({ model, sandbox, messages: asks("go") });
			const records = result.steps.map(toStepRecord);

			expect(records.map((record) => record.stepIndex)).toEqual([0, 1, 2, 3]);
			expect(records.map((record) => record.finishReason)).toEqual(["tool-calls", "tool-calls", "tool-calls", "stop"]);
			expect(records[0]?.inputTokens).toBe(100);
			expect(records[0]?.outputTokens).toBe(20);

			const written = records[0];
			const content = (written?.toolCalls[0]?.input as { content: string }).content;
			expect(content.length).toBeLessThan(2100);
			expect(content).toContain("characters not stored");
			expect(written?.toolResults[0]).toMatchObject({ name: "write", isError: false });
			expect(written?.toolResults[0]?.output).toContain("Created rec/big.txt");

			const failures = records[1]?.toolResults ?? [];
			expect(failures).toHaveLength(2);
			expect(failures[0]).toMatchObject({ isError: true, output: "File not found: no-such-file.txt" });
			expect(failures[1]?.isError).toBe(true);
			expect(failures[1]?.output).toContain("Invalid input");

			const output = records[2]?.toolResults[0]?.output ?? "";
			expect(output.length).toBeLessThan(10_100);
			expect(output).toContain("characters not stored");

			expect(records[3]).toMatchObject({ text: "All done.", toolCalls: [], toolResults: [] });
		});
	});
});
