import { DockerDriver, dockerAvailable, readText, type Sandbox } from "@nullfuse/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDeepSeekModel, runAgent } from "./index";

// Runs a real model, so it is opt-in:
//   DEEPSEEK_API_KEY=... pnpm --filter @nullfuse/agent test
const enabled = Boolean(process.env.DEEPSEEK_API_KEY) && (await dockerAvailable());

describe.skipIf(!enabled)("runAgent with a real model", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await new DockerDriver().create({ image: "alpine:3" });
	});

	afterAll(async () => {
		await sandbox?.destroy();
	});

	it("creates a file and checks it", async () => {
		const result = await runAgent({
			model: createDeepSeekModel("deepseek-flash"),
			sandbox,
			messages: [
				{
					role: "user",
					content: "Create hello.txt containing the word hi, then run cat hello.txt to check it.",
				},
			],
			limits: { maxSteps: 10, timeoutMs: 120_000 },
		});

		expect(result.stoppedBy).toBe("completed");
		expect((await readText(sandbox, "hello.txt")).trim()).toBe("hi");
		expect(result.usage.totalTokens).toBeGreaterThan(0);
	}, 150_000);
});
