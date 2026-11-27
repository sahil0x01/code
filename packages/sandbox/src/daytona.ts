import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	type CreateSandboxOptions,
	DEFAULT_EXEC_TIMEOUT_MS,
	type ExecOptions,
	type ExecResult,
	MAX_OUTPUT_BYTES,
	type Sandbox,
	type SandboxDriver,
	SandboxCapacityError,
	SandboxError,
} from "./types";
import { recordingImage } from "./docker";
import { findImageDir } from "./image-dir";

const DEFAULT_WORKDIR = "/home/daytona/workspace";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The part of the Daytona SDK this driver uses, so tests can stand in for the service.
export type DaytonaBox = {
	process: {
		executeCommand(
			command: string,
			cwd?: string,
			env?: Record<string, string>,
			timeoutSeconds?: number,
		): Promise<{ exitCode: number; result: string }>;
	};
	fs: {
		uploadFile(file: Buffer, remotePath: string): Promise<void>;
		downloadFile(remotePath: string): Promise<Buffer>;
	};
	delete(): Promise<void>;
};

export type DaytonaClient = {
	create(params: {
		snapshot: string;
		resources?: { cpu?: number; memory?: number };
		networkBlockAll?: boolean;
		labels?: Record<string, string>;
		autoDeleteInterval?: number;
	}): Promise<DaytonaBox>;
};

export type DaytonaDriverOptions = {
	client: DaytonaClient;
	/** A snapshot with git and node in it; see `ensureDaytonaSnapshot`. */
	snapshot: string;
};

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

function clip(text: string) {
	const bytes = Buffer.byteLength(text);
	if (bytes <= MAX_OUTPUT_BYTES) return { text, truncated: false };
	return { text: Buffer.from(text).subarray(0, MAX_OUTPUT_BYTES).toString(), truncated: true };
}

class DaytonaSandbox implements Sandbox {
	private destroyed = false;

	constructor(
		readonly id: string,
		readonly workdir: string,
		private box: DaytonaBox,
	) {}

	// The toolbox returns one output stream, so stderr goes to a file and comes back
	// after a marker. Callers rely on telling the two apart (`git ... | wc -l`).
	async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
		for (const name of Object.keys(options.env ?? {})) {
			if (!ENV_NAME.test(name)) throw new SandboxError(`Invalid environment variable name: ${name}`);
		}
		const tag = randomBytes(8).toString("hex");
		const errFile = `/tmp/.nf-err-${tag}`;
		const marker = `__NF_${tag}__`;
		const stdin = options.input === undefined ? "" : ` < ${quote(await this.stageInput(options.input, tag))}`;
		const script = [
			`sh -c ${quote(command)}${stdin} 2>${errFile}`,
			"code=$?",
			`printf '\\n%s\\n' ${marker}`,
			`cat ${errFile} 2>/dev/null; rm -f ${errFile}`,
			"exit $code",
		].join("; ");

		const timeoutMs = options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
		let stopped: "timeout" | "abort" | undefined;
		let onAbort: (() => void) | undefined;
		let timer: NodeJS.Timeout | undefined;

		// A command cannot be interrupted through the API, so give up on the call and
		// kill everything the sandbox user runs, like the Docker driver does.
		const interrupted = new Promise<null>((resolve) => {
			const stop = (why: "timeout" | "abort") => {
				stopped ??= why;
				resolve(null);
			};
			timer = setTimeout(() => stop("timeout"), timeoutMs);
			if (options.signal?.aborted) stop("abort");
			onAbort = () => stop("abort");
			options.signal?.addEventListener("abort", onAbort, { once: true });
		});

		const call = this.box.process
			.executeCommand(script, options.cwd ?? this.workdir, options.env, Math.ceil(timeoutMs / 1000) + 30)
			.catch((error: unknown) => {
				if (stopped) return null;
				throw new SandboxError(`Daytona command failed: ${error instanceof Error ? error.message : String(error)}`, {
					cause: error,
				});
			});

		try {
			const response = await Promise.race([call, interrupted]);
			if (response === null) {
				await this.box.process.executeCommand("kill -9 -1", undefined, undefined, 20).catch(() => {});
				return { exitCode: 137, stdout: "", stderr: "", timedOut: stopped === "timeout", truncated: false };
			}
			const at = response.result.lastIndexOf(`\n${marker}\n`);
			const out = at === -1 ? response.result : response.result.slice(0, at);
			const err = at === -1 ? "" : response.result.slice(at + marker.length + 2);
			const stdout = clip(out);
			const stderr = clip(err);
			return {
				exitCode: response.exitCode,
				stdout: stdout.text,
				stderr: stderr.text,
				timedOut: false,
				truncated: stdout.truncated || stderr.truncated,
			};
		} finally {
			clearTimeout(timer);
			if (onAbort) options.signal?.removeEventListener("abort", onAbort);
		}
	}

	private async stageInput(input: string | Uint8Array, tag: string) {
		const file = `/tmp/.nf-in-${tag}`;
		await this.box.fs.uploadFile(Buffer.from(input), file);
		return file;
	}

	private resolve(filePath: string) {
		return path.posix.resolve(this.workdir, filePath);
	}

	async readFile(requested: string): Promise<Uint8Array> {
		const filePath = this.resolve(requested);
		const size = await this.exec(`wc -c < ${quote(filePath)}`, { cwd: "/" });
		if (size.exitCode !== 0) throw new SandboxError(`Cannot read ${filePath}: ${size.stderr.trim()}`);
		if (Number(size.stdout.trim()) > MAX_OUTPUT_BYTES) {
			throw new SandboxError(`${filePath} is larger than ${MAX_OUTPUT_BYTES} bytes`);
		}
		return new Uint8Array(await this.box.fs.downloadFile(filePath));
	}

	async writeFile(requested: string, content: string | Uint8Array): Promise<void> {
		const filePath = this.resolve(requested);
		const made = await this.exec(`mkdir -p -- "$(dirname -- ${quote(filePath)})"`, { cwd: "/" });
		if (made.exitCode !== 0) throw new SandboxError(`Cannot write ${filePath}: ${made.stderr.trim()}`);
		await this.box.fs.uploadFile(Buffer.from(content), filePath);
	}

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		this.destroyed = true;
		await this.box.delete();
	}
}

// Daytona reports a full organisation pool only through the message.
const isCapacityMessage = (message: string) =>
	/\b(cpu|memory|disk|storage)\b.{0,60}\blimit exceeded/i.test(message);

export class DaytonaDriver implements SandboxDriver {
	readonly name = "daytona";

	constructor(private options: DaytonaDriverOptions) {}

	async create(options: CreateSandboxOptions = {}): Promise<Sandbox> {
		const workdir = options.workdir ?? DEFAULT_WORKDIR;
		let box: DaytonaBox;
		try {
			box = await this.options.client.create({
				// For this driver an image is the name of another snapshot.
				snapshot: options.image ?? this.options.snapshot,
				...((options.memoryMb || options.cpus) && {
					resources: {
						...(options.cpus && { cpu: options.cpus }),
						...(options.memoryMb && { memory: Math.max(1, Math.ceil(options.memoryMb / 1024)) }),
					},
				}),
				...(options.network === "none" && { networkBlockAll: true }),
				labels: { app: "nullfuse" },
				// Removed as soon as it stops, so a crashed worker cannot leave one running up cost.
				autoDeleteInterval: 0,
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			const Failure = isCapacityMessage(reason) ? SandboxCapacityError : SandboxError;
			throw new Failure(`Could not create a Daytona sandbox: ${reason}`, { cause: error });
		}
		const sandbox = new DaytonaSandbox(randomBytes(6).toString("hex"), workdir, box);
		try {
			const made = await sandbox.exec(`mkdir -p ${quote(workdir)}`, { cwd: "/" });
			if (made.exitCode !== 0) throw new SandboxError(`Cannot create ${workdir}: ${made.stderr.trim()}`);
		} catch (error) {
			await sandbox.destroy().catch(() => {});
			throw error;
		}
		return sandbox;
	}
}

const imageDir = () => findImageDir(path.dirname(fileURLToPath(import.meta.url)));

/** A CommonJS package imported from a bundle may carry its exports only on `default`. */
export function commonJsExports<T extends object>(imported: T): T {
	return (imported as { default?: T }).default ?? imported;
}

// SDK 2.x moved the documented client to `.v0`; v2 is a different API and is not used yet.
async function ensureSnapshot(
	apiKey: string,
	name: string,
	dockerfile: string,
	resources?: { cpu: number; memory: number },
) {
	const [{ Daytona }, sdk] = await Promise.all([import("@daytona/sdk"), import("@daytona/sdk/v0")]);
	const { Image } = commonJsExports(sdk);
	const v0 = new Daytona({ apiKey }).v0;
	try {
		await v0.snapshot.get(name);
	} catch {
		await v0.snapshot.create({ name, image: Image.fromDockerfile(dockerfile), resources });
	}
	return { client: v0 as unknown as DaytonaClient, snapshot: name };
}

// Builds the snapshot from the same Dockerfile the Docker driver uses, unless it exists.
export function ensureDaytonaSnapshot(apiKey: string, name = "nullfuse-sandbox") {
	return ensureSnapshot(apiKey, name, path.join(imageDir(), "Dockerfile"));
}

/** The snapshot with a browser. Its name changes with its files, so edits build a new one. */
export function ensureDaytonaRecordingSnapshot(apiKey: string) {
	return ensureSnapshot(
		apiKey,
		recordingImage().replace(":", "-"),
		path.join(imageDir(), "recording", "Dockerfile"),
		{ cpu: 2, memory: 4 },
	);
}
