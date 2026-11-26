import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DockerDriver, dockerAvailable, ensureSandboxImage } from "./docker";
import { readText } from "./index";
import { MAX_OUTPUT_BYTES, type Sandbox, SandboxError } from "./types";

const run = promisify(execFile);
const IMAGE = "alpine:3";

// Skipped locally without Docker; a failure in CI so they cannot silently stop.
const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the sandbox tests in CI");
}
if (!hasDocker) {
	console.warn("Docker is not running: skipping the sandbox tests");
}

describe.skipIf(!hasDocker)("DockerDriver", () => {
	const driver = new DockerDriver();
	let sandbox: Sandbox;

	beforeAll(async () => {
		await run("docker", ["pull", "--quiet", IMAGE]);
		sandbox = await driver.create({ image: IMAGE, memoryMb: 256 });
	});

	afterAll(async () => {
		await sandbox?.destroy();
	});

	describe("exec", () => {
		it("returns stdout, stderr and the exit code", async () => {
			const result = await sandbox.exec("echo out; echo err >&2; exit 3");
			expect(result).toMatchObject({
				exitCode: 3,
				stdout: "out\n",
				stderr: "err\n",
				timedOut: false,
				truncated: false,
			});
		});

		it("runs as an unprivileged user in the workspace", async () => {
			const result = await sandbox.exec("id -u; pwd");
			expect(result.stdout).toBe("1000\n/workspace\n");
		});

		it("honours cwd", async () => {
			await sandbox.exec("mkdir -p sub/dir");
			const result = await sandbox.exec("pwd", { cwd: "/workspace/sub/dir" });
			expect(result.stdout).toBe("/workspace/sub/dir\n");
		});

		it("passes input on stdin", async () => {
			const result = await sandbox.exec("cat", { input: "from stdin" });
			expect(result.stdout).toBe("from stdin");
		});

		it("does not keep shell state between commands", async () => {
			await sandbox.exec("export LEAK=1");
			const result = await sandbox.exec('echo "[$LEAK]"');
			expect(result.stdout).toBe("[]\n");
		});

		it("passes environment variables without putting values in arguments", async () => {
			const result = await sandbox.exec('printf %s "$SECRET_TOKEN"', {
				env: { SECRET_TOKEN: "s3cr3t value" },
			});
			expect(result.stdout).toBe("s3cr3t value");

			const after = await sandbox.exec('printf %s "$SECRET_TOKEN"');
			expect(after.stdout).toBe("");
		});

		it("rejects an invalid environment variable name", async () => {
			await expect(
				sandbox.exec("true", { env: { "BAD NAME": "x" } }),
			).rejects.toBeInstanceOf(SandboxError);
		});

		it("kills a command that runs too long, children included", async () => {
			const started = Date.now();
			const result = await sandbox.exec("sleep 60 & sleep 60", {
				timeoutMs: 1000,
			});
			expect(result.timedOut).toBe(true);
			expect(Date.now() - started).toBeLessThan(8000);

			const left = await sandbox.exec("ps | grep -c '[s]leep 60' || true");
			expect(left.stdout.trim()).toBe("0");
		});

		it("kills a running command when its signal aborts, and refuses to start one that is aborted", async () => {
			const controller = new AbortController();
			const started = Date.now();
			setTimeout(() => controller.abort(), 300);
			const result = await sandbox.exec("sleep 60", { signal: controller.signal, timeoutMs: 60_000 });
			expect(Date.now() - started).toBeLessThan(8000);
			expect(result.exitCode).not.toBe(0);
			expect(result.timedOut).toBe(false);

			const after = await sandbox.exec("echo still-alive");
			expect(after.stdout).toBe("still-alive\n");

			const skipped = await sandbox.exec("touch ran.txt", { signal: controller.signal });
			expect(skipped.exitCode).toBe(130);
			expect((await sandbox.exec("test -e ran.txt")).exitCode).not.toBe(0);
		});

		it("cuts output that is too large and says so", async () => {
			const result = await sandbox.exec(
				"head -c 3000000 /dev/zero | tr '\\0' a",
			);
			expect(result.truncated).toBe(true);
			expect(result.stdout.length).toBe(MAX_OUTPUT_BYTES);
			expect(result.exitCode).toBe(0);
		});
	});

	describe("files", () => {
		it("round-trips text, creating parent directories", async () => {
			await sandbox.writeFile("a/b/c.txt", "line 1\nline 2\n");
			expect(await readText(sandbox, "a/b/c.txt")).toBe("line 1\nline 2\n");
		});

		it("round-trips binary bytes", async () => {
			const bytes = Uint8Array.from([0, 1, 2, 255, 254, 10, 13, 0]);
			await sandbox.writeFile("bin.dat", bytes);
			expect([...(await sandbox.readFile("bin.dat"))]).toEqual([...bytes]);
		});

		it("overwrites an existing file", async () => {
			await sandbox.writeFile("over.txt", "a long first version");
			await sandbox.writeFile("over.txt", "short");
			expect(await readText(sandbox, "over.txt")).toBe("short");
		});

		it("treats a hostile file name as a name, not as shell", async () => {
			const name = 'we ird "name" $(touch pwned).txt';
			await sandbox.writeFile(name, "ok");
			expect(await readText(sandbox, name)).toBe("ok");

			const listing = await sandbox.exec("ls");
			expect(listing.stdout).not.toContain("pwned\n");
		});

		it("refuses to return a file it would have to cut", async () => {
			await sandbox.exec(`head -c ${MAX_OUTPUT_BYTES + 1} /dev/zero > big.dat`);
			await expect(sandbox.readFile("big.dat")).rejects.toThrow(/larger than/);

			await sandbox.exec(`head -c ${MAX_OUTPUT_BYTES} /dev/zero > exact.dat`);
			expect((await sandbox.readFile("exact.dat")).length).toBe(MAX_OUTPUT_BYTES);
		});

		it("rejects reading a file that does not exist", async () => {
			await expect(sandbox.readFile("nope/missing.txt")).rejects.toBeInstanceOf(
				SandboxError,
			);
		});
	});

	describe("isolation", () => {
		it("has no Linux capabilities and cannot gain any", async () => {
			const result = await sandbox.exec(
				"grep -E '^(CapEff|NoNewPrivs)' /proc/self/status",
			);
			expect(result.stdout).toMatch(/CapEff:\s+0000000000000000/);
			expect(result.stdout).toMatch(/NoNewPrivs:\s+1/);
		});

		it("applies the memory and process limits", async () => {
			const { stdout } = await run("docker", [
				"inspect",
				"--format",
				"{{.HostConfig.Memory}} {{.HostConfig.MemorySwap}} {{.HostConfig.PidsLimit}}",
				sandbox.id,
			]);
			const [memory, swap, pids] = stdout.trim().split(" ");
			expect(Number(memory)).toBe(256 * 1024 * 1024);
			expect(swap).toBe(memory);
			expect(Number(pids)).toBe(512);
		});

		it("can be created with no network", async () => {
			const offline = await driver.create({ image: IMAGE, network: "none" });
			try {
				const result = await offline.exec("wget -T 2 -q -O- http://example.com");
				expect(result.exitCode).not.toBe(0);
			} finally {
				await offline.destroy();
			}
		});

		it("gives each sandbox its own filesystem", async () => {
			const other = await driver.create({ image: IMAGE });
			try {
				await sandbox.writeFile("mine.txt", "mine");
				const result = await other.exec("ls");
				expect(result.stdout).not.toContain("mine.txt");
			} finally {
				await other.destroy();
			}
		});
	});

	describe("destroy", () => {
		it("removes the container and can be called twice", async () => {
			const temp = await driver.create({ image: IMAGE });
			await temp.destroy();
			await expect(temp.destroy()).resolves.toBeUndefined();
			await expect(run("docker", ["inspect", temp.id])).rejects.toThrow();
		});
	});

	describe("the sandbox image", () => {
		it("has git, node and pnpm, and runs as an unprivileged user", async () => {
			const image = await ensureSandboxImage();
			const box = await driver.create({ image });
			try {
				const result = await box.exec("git --version && node --version && pnpm --version && id -u");
				expect(result.exitCode).toBe(0);
				expect(result.stdout).toMatch(/^git version .+\nv24\./);
				expect(result.stdout.trim().endsWith("1000")).toBe(true);

				// The workspace belongs to the sandbox user, or git refuses to use it.
				const repo = await box.exec("git init -q && git status --short && stat -c %u .");
				expect(repo.stderr).toBe("");
				expect(repo.stdout.trim()).toBe("1000");
			} finally {
				await box.destroy();
			}
		}, 600_000);
	});
});
