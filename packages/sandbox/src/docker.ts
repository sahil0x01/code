import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
	type CreateSandboxOptions,
	DEFAULT_EXEC_TIMEOUT_MS,
	type ExecOptions,
	type ExecResult,
	MAX_OUTPUT_BYTES,
	type Sandbox,
	type SandboxDriver,
	SandboxError,
} from "./types";
import { findImageDir } from "./image-dir";

const LABEL = "nullfuse.sandbox";
const DEFAULT_IMAGE = "node:24-bookworm-slim";
const DEFAULT_WORKDIR = "/workspace";
// Numeric, so it works with images that have no passwd entry for it.
const SANDBOX_USER = "1000:1000";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

type RunOptions = {
	input?: string | Uint8Array;
	env?: Record<string, string>;
	timeoutMs?: number;
};

type RunResult = {
	exitCode: number;
	stdout: Buffer;
	stderr: Buffer;
	killed: boolean;
	truncated: boolean;
};

// Keeps reading past the limit so the child never blocks on a full pipe.
function collector(limit: number) {
	const chunks: Buffer[] = [];
	let size = 0;
	let truncated = false;
	return {
		push(chunk: Buffer) {
			if (size >= limit) {
				truncated = true;
				return;
			}
			const room = limit - size;
			if (chunk.length > room) {
				chunks.push(chunk.subarray(0, room));
				size = limit;
				truncated = true;
			} else {
				chunks.push(chunk);
				size += chunk.length;
			}
		},
		get buffer() {
			return Buffer.concat(chunks);
		},
		get truncated() {
			return truncated;
		},
	};
}

function runDocker(args: string[], options: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", args, {
			env: { ...process.env, ...options.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const out = collector(MAX_OUTPUT_BYTES);
		const err = collector(MAX_OUTPUT_BYTES);
		let killed = false;

		const timer = options.timeoutMs
			? setTimeout(() => {
					killed = true;
					child.kill("SIGKILL");
				}, options.timeoutMs)
			: undefined;

		child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
		// EPIPE when the command exits without reading its input.
		child.stdin.on("error", () => {});

		child.on("error", (error) => {
			clearTimeout(timer);
			reject(new SandboxError(`Could not run docker: ${error.message}`, { cause: error }));
		});
		child.on("close", (code, signal) => {
			clearTimeout(timer);
			resolve({
				exitCode: code ?? (signal ? 137 : 1),
				stdout: out.buffer,
				stderr: err.buffer,
				killed,
				truncated: out.truncated || err.truncated,
			});
		});

		child.stdin.end(options.input);
	});
}

export async function dockerAvailable() {
	try {
		const result = await runDocker(["info", "--format", "{{.ServerVersion}}"], {
			timeoutMs: 10_000,
		});
		return result.exitCode === 0;
	} catch {
		return false;
	}
}

export async function destroyAllDockerSandboxes() {
	const listed = await runDocker(["ps", "-aq", "--filter", `label=${LABEL}=1`]);
	const ids = listed.stdout.toString().split("\n").filter(Boolean);
	if (ids.length > 0) await runDocker(["rm", "-f", ...ids]);
}

const imageDir = () => findImageDir(import.meta.dirname);
const recordingDir = () => path.join(imageDir(), "recording");

// Tagged with a hash of the files that go in, so editing one builds a new image.
function imageTag(name: string, dir: string, files: string[]) {
	const hash = createHash("sha256");
	for (const file of files) hash.update(readFileSync(path.join(dir, file)));
	return `${name}:${hash.digest("hex").slice(0, 12)}`;
}

export function sandboxImage() {
	return imageTag("nullfuse-sandbox", imageDir(), ["Dockerfile"]);
}

/** The larger image with a browser, only for runs that record a video. */
export function recordingImage() {
	return imageTag("nullfuse-recording", recordingDir(), ["Dockerfile", "record.mjs"]);
}

async function ensureImage(tag: string, dir: string) {
	const found = await runDocker(["image", "inspect", tag]);
	if (found.exitCode === 0) return tag;

	const built = await runDocker(["build", "--quiet", "-t", tag, dir], {
		timeoutMs: 15 * 60_000,
	});
	if (built.exitCode !== 0) throw failure("Building the sandbox image", built);
	return tag;
}

export function ensureSandboxImage() {
	return ensureImage(sandboxImage(), imageDir());
}

export function ensureRecordingImage() {
	return ensureImage(recordingImage(), recordingDir());
}

function failure(action: string, result: RunResult) {
	const detail = result.stderr.toString().trim() || `exit code ${result.exitCode}`;
	return new SandboxError(`${action} failed: ${detail}`);
}

class DockerSandbox implements Sandbox {
	constructor(
		readonly id: string,
		readonly workdir: string,
	) {}

	async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
		const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;

		const args = ["exec", "-i", "-u", SANDBOX_USER];
		if (options.cwd) args.push("-w", options.cwd);

		// Values go in the docker CLI's environment, not argv, which `ps` shows.
		const env: Record<string, string> = {};
		for (const [name, value] of Object.entries(options.env ?? {})) {
			if (!ENV_NAME.test(name)) {
				throw new SandboxError(`Invalid environment variable name: ${name}`);
			}
			args.push("-e", name);
			env[name] = value;
		}

		args.push(this.id, "sh", "-c", command);

		if (options.signal?.aborted) {
			return { exitCode: 130, stdout: "", stderr: "aborted", timedOut: false, truncated: false };
		}

		// Killing the docker CLI would not stop the command inside the container.
		const killAll = () =>
			runDocker(["exec", "-u", SANDBOX_USER, this.id, "sh", "-c", "kill -9 -1"]).catch(
				() => {},
			);
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			void killAll();
		}, timeoutMs);
		options.signal?.addEventListener("abort", killAll, { once: true });

		let result: RunResult;
		try {
			result = await runDocker(args, {
				input: options.input,
				env,
				timeoutMs: timeoutMs + 10_000,
			});
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", killAll);
		}

		timedOut = timedOut || result.killed;
		return {
			exitCode: result.exitCode,
			stdout: result.stdout.toString("utf8"),
			stderr: result.stderr.toString("utf8"),
			timedOut,
			truncated: result.truncated,
		};
	}

	async readFile(path: string): Promise<Uint8Array> {
		const result = await runDocker(["exec", "-u", SANDBOX_USER, this.id, "cat", "--", path]);
		if (result.exitCode !== 0) throw failure(`Reading ${path}`, result);
		// The output cap would otherwise return a silently cut file.
		if (result.truncated) {
			throw new SandboxError(
				`Reading ${path} failed: the file is larger than ${MAX_OUTPUT_BYTES} bytes`,
			);
		}
		return new Uint8Array(result.stdout);
	}

	async writeFile(path: string, content: string | Uint8Array): Promise<void> {
		// The path is passed as $1, never spliced into the script.
		const result = await runDocker(
			[
				"exec",
				"-i",
				"-u",
				SANDBOX_USER,
				this.id,
				"sh",
				"-c",
				'mkdir -p -- "$(dirname -- "$1")" && cat > "$1"',
				"sh",
				path,
			],
			{ input: content },
		);
		if (result.exitCode !== 0) throw failure(`Writing ${path}`, result);
	}

	async destroy(): Promise<void> {
		await runDocker(["rm", "-f", this.id]);
	}
}

export class DockerDriver implements SandboxDriver {
	readonly name = "docker";

	async create(options: CreateSandboxOptions = {}): Promise<Sandbox> {
		const memoryMb = options.memoryMb ?? 2048;
		const workdir = options.workdir ?? DEFAULT_WORKDIR;
		const id = `nf-sbx-${randomBytes(6).toString("hex")}`;

		const args = [
			"run",
			"-d",
			"--name",
			id,
			"--label",
			`${LABEL}=1`,
			"--label",
			`nullfuse.created=${Date.now()}`,
			"--memory",
			`${memoryMb}m`,
			"--memory-swap",
			`${memoryMb}m`,
			"--cpus",
			String(options.cpus ?? 2),
			"--pids-limit",
			String(options.pidsLimit ?? 512),
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--user",
			SANDBOX_USER,
			"--env",
			"HOME=/tmp",
			"--workdir",
			workdir,
		];
		if (options.network === "none") args.push("--network", "none");
		args.push(options.image ?? DEFAULT_IMAGE, "tail", "-f", "/dev/null");

		const started = await runDocker(args, { timeoutMs: 120_000 });
		if (started.exitCode !== 0) throw failure("Starting the sandbox", started);

		// An image can ship a workdir the sandbox user owns. Otherwise Docker creates
		// it owned by root, so open it to the sandbox user.
		const writable = await runDocker([
			"exec",
			"-u",
			SANDBOX_USER,
			id,
			"sh",
			"-c",
			'test -w "$1"',
			"sh",
			workdir,
		]);
		if (writable.exitCode !== 0) {
			const prepared = await runDocker([
				"exec",
				"-u",
				"0",
				id,
				"sh",
				"-c",
				'mkdir -p -- "$1" && chmod 1777 "$1"',
				"sh",
				workdir,
			]);
			if (prepared.exitCode !== 0) {
				await runDocker(["rm", "-f", id]);
				throw failure("Preparing the workspace", prepared);
			}
		}

		return new DockerSandbox(id, workdir);
	}
}
