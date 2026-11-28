import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Agent37Driver, destroyStaleAgent37 } from "./agent37";
import { dockerAvailable, ensureSandboxImage } from "./docker";
import { readText } from "./index";
import { MAX_OUTPUT_BYTES, type Sandbox, SandboxCapacityError, SandboxError } from "./types";

const docker = promisify(execFile);
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

type Sent = { method: string; url: string; headers: Record<string, string>; body?: Record<string, unknown> };

// Stands in for the service. `exec` answers the command calls.
function service(exec: (command: string) => Promise<Response> | Response = () => reply(200, {})) {
	const sent: Sent[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		const body = init.body ? JSON.parse(String(init.body)) : undefined;
		sent.push({ method: init.method ?? "GET", url, headers: init.headers as Record<string, string>, body });
		if (url.endsWith("/exec")) {
			const aborted = new Promise<never>((_, reject) =>
				init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
			);
			return Promise.race([exec(body.command), aborted]);
		}
		if (init.method === "DELETE") return reply(200, { deleted: true });
		return reply(201, { id: "box1", status: "running" });
	}) as typeof fetch;
	const driver = new Agent37Driver({ apiKey: "key", template: "plain-template", fetcher, retryMs: 1 });
	return { sent, fetcher, driver };
}

const ok = () => reply(200, { exit_code: 0, stdout: "", stderr: "", truncated: false });

describe("Agent37Driver requests", () => {
	it("creates a labelled sandbox that sleeps when idle, with the network rules", async () => {
		const { driver, sent } = service(ok);
		await driver.create({ allowedDomains: ["github.com"], image: "browser-template" });

		expect(sent[0]).toMatchObject({
			method: "POST",
			url: "https://api.agent37.com/v1/instances",
			headers: { authorization: "Bearer key" },
			body: {
				template: "browser-template",
				network: { allow: ["github.com"] },
				metadata: { app: "nullfuse" },
				auto_sleep: true,
				resources: { cpu: 2, memory: 4, disk: 4 },
			},
		});
		expect(sent[1]?.url).toBe("https://sandbox.agent37.app/v1/instances/box1/exec");
		expect(sent[1]?.headers).toMatchObject({ "x-agent37-key": "key" });
	});

	it("blocks everything, or nothing, when asked", async () => {
		const { driver, sent } = service(ok);
		await driver.create({ network: "none", allowedDomains: ["github.com"] });
		await driver.create({});

		const created = sent.filter((request) => request.url.endsWith("/instances"));
		expect(created.map((request) => request.body?.network)).toEqual(["deny-all", "allow-all"]);
	});

	it("reports a full account as having no room, and other refusals as failures", async () => {
		const refusing = (status: number, code: string) =>
			new Agent37Driver({
				apiKey: "key",
				template: "t",
				retryMs: 1,
				fetcher: (async () => reply(status, { error: { code, message: "no" } })) as typeof fetch,
			});

		await expect(refusing(409, "instance_limit_reached").create()).rejects.toBeInstanceOf(SandboxCapacityError);
		const broke = await refusing(402, "insufficient_balance")
			.create()
			.catch((error) => error);
		expect(broke).toBeInstanceOf(SandboxError);
		expect(broke).not.toBeInstanceOf(SandboxCapacityError);
		expect(broke.message).toContain("insufficient_balance");
	});

	it("tries a busy command again under the same name", async () => {
		let calls = 0;
		const { driver, sent } = service(() => (++calls === 2 ? reply(503, { error: "try_again" }) : ok()));
		const sandbox = await driver.create();

		await sandbox.exec("true");

		const names = sent.filter((request) => request.url.endsWith("/exec")).map((request) => request.body?.name);
		expect(names).toHaveLength(3);
		expect(names[1]).toBe(names[2]);
	});

	it("does not repeat a command the service is still running", async () => {
		let calls = 0;
		const { driver } = service(() => (++calls === 1 ? ok() : reply(504, { error: "try_again" })));
		const sandbox = await driver.create();

		await expect(sandbox.exec("sleep 1000")).rejects.toBeInstanceOf(SandboxError);
		expect(calls).toBe(2);
	});

	it("deletes only our own old sandboxes", async () => {
		const deleted: string[] = [];
		const now = 10_000_000;
		const fetcher = (async (url: string, init: RequestInit) => {
			if (init.method === "DELETE") {
				deleted.push(url.split("/").at(-1) ?? "");
				return reply(200, {});
			}
			const ours = { app: "nullfuse" };
			return reply(200, {
				data: [
					{ id: "old", created: 1000, metadata: ours },
					{ id: "new", created: 9_990, metadata: ours },
					{ id: "other", created: 1000, metadata: null },
				],
			});
		}) as typeof fetch;

		await expect(destroyStaleAgent37({ apiKey: "k", fetcher, olderThanMs: 60_000, now })).resolves.toEqual({
			removed: 1,
			failed: [],
		});
		expect(deleted).toEqual(["old"]);
	});
});

const hasDocker = await dockerAvailable();

// Commands run in a real Linux container, with the same limits the service puts on them.
describe.skipIf(!hasDocker)("Agent37Driver commands", () => {
	const name = `nf-agent37-test-${randomBytes(4).toString("hex")}`;
	let sandbox: Sandbox;
	const largest = { command: 0 };

	const exec = (command: string) => {
		largest.command = Math.max(largest.command, Buffer.byteLength(command));
		return new Promise<Response>((resolve) => {
			const child = spawn("docker", ["exec", name, "sh", "-c", command]);
			const out: Buffer[] = [];
			const err: Buffer[] = [];
			child.stdout.on("data", (chunk) => out.push(chunk));
			child.stderr.on("data", (chunk) => err.push(chunk));
			child.on("close", (code) =>
				resolve(
					reply(200, {
						exit_code: code ?? 137,
						stdout: Buffer.concat(out).subarray(0, 512 * 1024).toString(),
						stderr: Buffer.concat(err).toString(),
						truncated: false,
					}),
				),
			);
		});
	};

	beforeAll(async () => {
		const image = await ensureSandboxImage();
		await docker("docker", ["run", "-d", "--name", name, "--user", "node", image, "tail", "-f", "/dev/null"]);
		sandbox = await service(exec).driver.create({ workdir: "/workspace" });
	}, 15 * 60_000);

	afterAll(async () => {
		await docker("docker", ["rm", "-f", name]).catch(() => {});
	});

	it("returns output and the exit code, in the working directory", async () => {
		await expect(sandbox.exec("pwd; echo err >&2; exit 3")).resolves.toMatchObject({
			exitCode: 3,
			stdout: "/workspace\n",
			stderr: "err\n",
		});
	});

	it("passes variables and input exactly, and keeps no state", async () => {
		const secret = `it's "$HOME" \n; rm -rf /`;
		const result = await sandbox.exec('printf %s "$SECRET"; cat', { env: { SECRET: secret }, input: "|stdin" });
		expect(result.stdout).toBe(`${secret}|stdin`);
		await expect(sandbox.exec('echo "[$SECRET]"')).resolves.toMatchObject({ stdout: "[]\n" });
	});

	it("writes and reads binary files larger than one request", async () => {
		const data = randomBytes(MAX_OUTPUT_BYTES - 1);
		await sandbox.writeFile("deep/er/it's.bin", data);
		expect(Buffer.from(await sandbox.readFile("deep/er/it's.bin")).equals(data)).toBe(true);
		expect(largest.command).toBeLessThan(128 * 1024);
	});

	it("writes an empty file and keeps a script executable", async () => {
		await sandbox.writeFile("empty", "");
		await expect(readText(sandbox, "empty")).resolves.toBe("");
		await sandbox.exec("printf '#!/bin/sh\\necho a' > run.sh && chmod +x run.sh");
		await sandbox.writeFile("run.sh", "#!/bin/sh\necho b");
		await expect(sandbox.exec("./run.sh")).resolves.toMatchObject({ stdout: "b\n" });
	});

	it("refuses to read a file that is too large or missing", async () => {
		await sandbox.exec(`head -c ${MAX_OUTPUT_BYTES + 1} /dev/zero > big`);
		await expect(sandbox.readFile("big")).rejects.toThrow("larger than");
		await expect(sandbox.readFile("missing")).rejects.toBeInstanceOf(SandboxError);
	});

	// A killed process can linger as a zombie here, so only live ones are counted.
	const running = async () =>
		(await sandbox.exec("cat /proc/[0-9]*/stat 2>/dev/null | grep -c '(sleep) [^Z]' || true")).stdout.trim();

	it("ends everything a command started when it times out", async () => {
		const result = await sandbox.exec("sleep 60 & sleep 60", { timeoutMs: 1500 });
		expect(result.timedOut).toBe(true);
		await expect(running()).resolves.toBe("0");
	});

	it("stops when asked, without calling it a timeout", async () => {
		const stop = new AbortController();
		setTimeout(() => stop.abort(), 1000);
		await expect(sandbox.exec("sleep 60", { signal: stop.signal })).resolves.toMatchObject({
			exitCode: 130,
			timedOut: false,
		});
		await expect(running()).resolves.toBe("0");
	});
});
