import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { commonJsExports, type DaytonaBox, type DaytonaClient, DaytonaDriver } from "./daytona";
import { MAX_OUTPUT_BYTES, type Sandbox, SandboxCapacityError, SandboxError } from "./types";

// Stands in for the Daytona service: runs commands in a local shell. The real
// "kill everything" command is replaced by killing only this fake's own processes.
class FakeBox implements DaytonaBox {
	children = new Set<number>();
	deleted = 0;
	killed = 0;
	calls: { command: string; cwd?: string; env?: Record<string, string>; timeout?: number }[] = [];

	process = {
		executeCommand: (command: string, cwd?: string, env?: Record<string, string>, timeout?: number) => {
			this.calls.push({ command, cwd, env, timeout });
			if (command === "kill -9 -1") {
				this.killed++;
				for (const pid of this.children) {
					try {
						process.kill(-pid, "SIGKILL");
					} catch {}
				}
				return Promise.resolve({ exitCode: 0, result: "" });
			}
			return new Promise<{ exitCode: number; result: string }>((resolve) => {
				const child = spawn("sh", ["-c", command], { cwd, env: { ...process.env, ...env }, detached: true });
				if (child.pid) this.children.add(child.pid);
				let out = "";
				child.stdout.on("data", (chunk) => {
					out += chunk;
				});
				child.on("close", (code) => resolve({ exitCode: code ?? 137, result: out }));
			});
		},
	};

	fs = {
		uploadFile: async (file: Buffer, remotePath: string) => writeFileSync(remotePath, file),
		downloadFile: async (remotePath: string) => readFileSync(remotePath),
	};

	async delete() {
		this.deleted++;
	}
}

describe("DaytonaDriver", () => {
	const root = realpathSync(mkdtempSync(path.join(tmpdir(), "daytona-fake-")));
	const box = new FakeBox();
	let created: unknown[] = [];
	const client: DaytonaClient = {
		create: async (params) => {
			created.push(params);
			return box;
		},
	};
	let sandbox: Sandbox;

	beforeAll(async () => {
		sandbox = await new DaytonaDriver({ client, snapshot: "snap" }).create({
			workdir: path.join(root, "work"),
			memoryMb: 1536,
			cpus: 2,
			network: "none",
		});
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	it("creates the sandbox from the snapshot with its limits, and makes the workdir", () => {
		expect(created[0]).toMatchObject({
			snapshot: "snap",
			resources: { cpu: 2, memory: 2 },
			networkBlockAll: true,
			autoDeleteInterval: 0,
		});
		expect(sandbox.workdir).toBe(path.join(root, "work"));
	});

	it("keeps stdout and stderr apart and returns the exit code", async () => {
		const result = await sandbox.exec("echo out; echo err >&2; exit 3");
		expect(result).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n", timedOut: false, truncated: false });
	});

	it("keeps output exactly, including a missing trailing newline and blank output", async () => {
		expect((await sandbox.exec("printf abc")).stdout).toBe("abc");
		expect(await sandbox.exec("true")).toMatchObject({ stdout: "", stderr: "" });
	});

	it("runs in the given directory with the given environment", async () => {
		const result = await sandbox.exec("pwd; echo $GREETING", { cwd: root, env: { GREETING: "hi" } });
		expect(result.stdout).toBe(`${root}\nhi\n`);
	});

	it("runs in the workdir unless told otherwise", async () => {
		expect((await sandbox.exec("pwd")).stdout).toBe(`${path.join(root, "work")}\n`);
	});

	it("rejects an invalid environment variable name before running anything", async () => {
		const before = box.calls.length;
		await expect(sandbox.exec("true", { env: { "bad name": "x" } })).rejects.toThrow("Invalid environment variable name");
		expect(box.calls.length).toBe(before);
	});

	it("passes input to the command", async () => {
		expect((await sandbox.exec("cat", { input: "from stdin" })).stdout).toBe("from stdin");
	});

	it("keeps quotes in the command intact", async () => {
		expect((await sandbox.exec(`echo "it's" '"q"'`)).stdout).toBe(`it's "q"\n`);
	});

	it("cuts output at the limit and says so", async () => {
		const result = await sandbox.exec(`head -c ${MAX_OUTPUT_BYTES + 5000} /dev/zero | tr '\\0' a`);
		expect(result.truncated).toBe(true);
		expect(result.stdout.length).toBe(MAX_OUTPUT_BYTES);
	});

	it("kills everything when the command times out", async () => {
		const started = Date.now();
		const result = await sandbox.exec("sleep 30", { timeoutMs: 300 });
		expect(Date.now() - started).toBeLessThan(5000);
		expect(result).toMatchObject({ timedOut: true, exitCode: 137 });
		expect(box.killed).toBeGreaterThan(0);
	});

	it("kills everything when aborted, without calling it a timeout", async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 200);
		const result = await sandbox.exec("sleep 30", { signal: controller.signal });
		expect(result).toMatchObject({ timedOut: false, exitCode: 137 });
		expect((await sandbox.exec("echo ok", { signal: AbortSignal.abort() })).exitCode).toBe(137);
	});

	it("writes files, creating folders, and reads them back", async () => {
		const file = path.join(root, "work", "a", "b.txt");
		await sandbox.writeFile(file, "hello");
		expect(new TextDecoder().decode(await sandbox.readFile(file))).toBe("hello");
		await expect(sandbox.readFile(path.join(root, "missing"))).rejects.toThrow("Cannot read");
	});

	it("reads and writes relative paths inside the workdir", async () => {
		await sandbox.writeFile("rel/dir/x.txt", "relative");
		expect(readFileSync(path.join(root, "work", "rel", "dir", "x.txt"), "utf8")).toBe("relative");
		expect(new TextDecoder().decode(await sandbox.readFile("rel/dir/x.txt"))).toBe("relative");
	});

	it("refuses to read a file larger than the output limit", async () => {
		const big = path.join(root, "big.bin");
		writeFileSync(big, Buffer.alloc(MAX_OUTPUT_BYTES + 1));
		await expect(sandbox.readFile(big)).rejects.toThrow("larger than");
	});

	it("wraps a failing service call, and deletes the sandbox once", async () => {
		const failing = new DaytonaDriver({
			client: { create: async () => Promise.reject(new Error("quota exceeded")) },
			snapshot: "snap",
		});
		await expect(failing.create()).rejects.toThrow("Could not create a Daytona sandbox: quota exceeded");

		await sandbox.destroy();
		await sandbox.destroy();
		expect(box.deleted).toBe(1);
	});
});

describe("commonJsExports", () => {
	it("reads exports from a bundled module and from a native one", () => {
		const exports = { Image: "image" };
		expect(commonJsExports({ default: exports } as unknown as typeof exports).Image).toBe("image");
		expect(commonJsExports(exports).Image).toBe("image");
	});
});

describe("DaytonaDriver create errors", () => {
	const failing = (message: string) =>
		new DaytonaDriver({
			client: {
				create: async () => {
					throw new Error(message);
				},
			},
			snapshot: "snap",
		}).create();

	it("tells a full pool apart from other failures", async () => {
		await expect(failing("Total memory limit exceeded. Maximum allowed: 10GiB.")).rejects.toThrow(SandboxCapacityError);
		const other = await failing("Snapshot not found").catch((error) => error);
		expect(other).toBeInstanceOf(SandboxError);
		expect(other).not.toBeInstanceOf(SandboxCapacityError);
	});
});
