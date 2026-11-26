import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DaytonaDriver, ensureDaytonaSnapshot } from "./daytona";
import type { Sandbox } from "./types";

// Uses the real service (and costs a little), so it is opt-in:
//   DAYTONA_API_KEY=... pnpm --filter @nullfuse/sandbox test
const apiKey = process.env.DAYTONA_API_KEY;

describe.skipIf(!apiKey)("DaytonaDriver against the real service", () => {
	let sandbox: Sandbox;

	beforeAll(async () => {
		const { client, snapshot } = await ensureDaytonaSnapshot(apiKey ?? "");
		sandbox = await new DaytonaDriver({ client, snapshot }).create();
	}, 600_000);

	afterAll(async () => {
		await sandbox?.destroy();
	});

	it("runs commands in the workdir with separate stdout and stderr", async () => {
		const result = await sandbox.exec("pwd; echo out; echo err >&2; exit 4");
		expect(result).toMatchObject({ exitCode: 4, stderr: "err\n", timedOut: false });
		expect(result.stdout).toBe(`${sandbox.workdir}\nout\n`);
	}, 60_000);

	it("has git and node, and a writable workdir", async () => {
		const result = await sandbox.exec("git --version && node --version && touch probe && echo ok");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("ok");
	}, 60_000);

	it("passes environment and input", async () => {
		expect((await sandbox.exec("echo $X; cat", { env: { X: "val" }, input: "in" })).stdout).toBe("val\nin");
	}, 60_000);

	it("writes and reads files", async () => {
		const file = `${sandbox.workdir}/deep/dir/f.txt`;
		await sandbox.writeFile(file, "hello");
		expect(new TextDecoder().decode(await sandbox.readFile(file))).toBe("hello");
		await sandbox.writeFile("rel.txt", "relative");
		expect(new TextDecoder().decode(await sandbox.readFile("rel.txt"))).toBe("relative");
		expect((await sandbox.exec("cat rel.txt")).stdout).toBe("relative");
	}, 60_000);

	it("stops a command that runs too long", async () => {
		const started = Date.now();
		const result = await sandbox.exec("sleep 120", { timeoutMs: 3000 });
		expect(result.timedOut).toBe(true);
		expect(Date.now() - started).toBeLessThan(30_000);
		expect((await sandbox.exec("echo alive")).stdout).toBe("alive\n");
	}, 120_000);
});
