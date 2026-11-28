import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agent37Template } from "../image/agent37.mjs";
import { findImageDir } from "./image-dir";
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

const API = "https://api.agent37.com/v1";
const EXEC_API = "https://sandbox.agent37.app/v1";
const DEFAULT_WORKDIR = "/home/node/workspace";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LABEL = "nullfuse";
// The smallest shape on offer.
const RESOURCES = { cpu: 2, memory: 4, disk: 4 };
// A sleeping sandbox is billed for its disk only. This catches one whose worker died.
const IDLE_SECONDS = 300;
// The exec call gives up after 15 minutes while the command keeps going.
const MAX_EXEC_MS = 14 * 60_000;
// One argument to `sh -c` cannot pass 128 KB.
const MAX_SCRIPT_BYTES = 120_000;
const WRITE_CHUNK_BYTES = 60_000;
// Becomes 400 KB of base64, inside the 512 KB output limit.
const READ_CHUNK_BYTES = 300_000;
const RETRIES = 4;

export type Agent37Options = {
	apiKey: string;
	/** The template with git and node; see `agent37Templates`. */
	template: string;
	fetcher?: typeof fetch;
	/** The first wait before trying a busy service again. It doubles each time. */
	retryMs?: number;
};

export class Agent37Error extends SandboxError {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(`Agent37 refused the request (${status} ${code}): ${message}`);
		this.name = "Agent37Error";
	}
}

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

type Connection = Pick<Agent37Options, "apiKey" | "fetcher" | "retryMs">;

type Request = { method: string; url: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal };

async function once<T>({ apiKey, fetcher = fetch }: Connection, request: Request): Promise<T> {
	const signals = [AbortSignal.timeout(request.timeoutMs ?? 60_000), ...(request.signal ? [request.signal] : [])];
	const response = await fetcher(request.url, {
		method: request.method,
		headers: {
			...(request.url.startsWith(EXEC_API)
				? { "x-agent37-key": apiKey }
				: { authorization: `Bearer ${apiKey}` }),
			...(request.body !== undefined && { "content-type": "application/json" }),
		},
		body: request.body === undefined ? undefined : JSON.stringify(request.body),
		signal: AbortSignal.any(signals),
	});
	const data = (await response.json().catch(() => ({}))) as { error?: string | { code?: string; message?: string } };
	if (!response.ok) {
		// The exec host answers with a plain string, the rest with an object.
		const error = typeof data.error === "string" ? { code: data.error } : (data.error ?? {});
		throw new Agent37Error(response.status, error.code ?? "unknown", error.message ?? response.statusText);
	}
	return data as T;
}

// Only refusals that mean nothing happened are tried again. A 504 means the command is still
// running.
const isBusy = (error: unknown) =>
	error instanceof Agent37Error &&
	(error.status === 429 || (error.status !== 504 && ["try_again", "no_capacity"].includes(error.code)));

async function call<T>(connection: Connection, request: Request): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await once<T>(connection, request);
		} catch (error) {
			if (attempt >= RETRIES || !isBusy(error) || request.signal?.aborted) throw error;
			await new Promise((resolve) => setTimeout(resolve, (connection.retryMs ?? 500) * 2 ** attempt));
		}
	}
}

type ExecReply = { exit_code: number; stdout: string; stderr: string; truncated: boolean };

class Agent37Sandbox implements Sandbox {
	private destroyed = false;

	constructor(
		readonly id: string,
		readonly workdir: string,
		private connection: Connection,
	) {}

	run(script: string, timeoutMs: number, signal?: AbortSignal) {
		if (Buffer.byteLength(script) > MAX_SCRIPT_BYTES) {
			throw new SandboxError("The command is too long for this sandbox. Put it in a file and run that.");
		}
		return call<ExecReply>(this.connection, {
			method: "POST",
			url: `${EXEC_API}/instances/${this.id}/exec`,
			// The name makes a repeated request the same command, not a second one.
			body: { command: script, name: randomBytes(12).toString("hex") },
			timeoutMs,
			signal,
		});
	}

	async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
		const exports = Object.entries(options.env ?? {}).map(([name, value]) => {
			if (!ENV_NAME.test(name)) throw new SandboxError(`Invalid environment variable name: ${name}`);
			return `export ${name}=${quote(value)}`;
		});
		const stopped = (timedOut: boolean): ExecResult => ({
			exitCode: timedOut ? 137 : 130,
			stdout: "",
			stderr: timedOut ? "" : "aborted",
			timedOut,
			truncated: false,
		});
		if (options.signal?.aborted) return stopped(false);

		const tag = randomBytes(8).toString("hex");
		const pidFile = `/tmp/.nf-pid-${tag}`;
		let stdin = "";
		if (options.input !== undefined) {
			const file = `/tmp/.nf-in-${tag}`;
			await this.writeFile(file, options.input);
			stdin = ` < ${file}`;
		}
		const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_MS);
		// Its own process group, so a timeout can end everything the command started.
		const script = [
			...exports,
			`cd ${quote(options.cwd ?? this.workdir)} || exit 126`,
			`setsid -w sh -c 'echo $$ > "$0"; exec sh -c "$1"' ${pidFile} ${quote(command)}${stdin}`,
			"code=$?",
			`rm -f ${pidFile} /tmp/.nf-in-${tag}`,
			"exit $code",
		].join("\n");

		const interrupt = new AbortController();
		let why: "timeout" | "abort" | undefined;
		const stop = (reason: "timeout" | "abort") => {
			why ??= reason;
			interrupt.abort();
		};
		const timer = setTimeout(() => stop("timeout"), timeoutMs);
		const onAbort = () => stop("abort");
		options.signal?.addEventListener("abort", onAbort, { once: true });

		try {
			const reply = await this.run(script, timeoutMs + 30_000, interrupt.signal);
			return {
				exitCode: reply.exit_code,
				stdout: reply.stdout,
				stderr: reply.stderr,
				timedOut: false,
				truncated: reply.truncated,
			};
		} catch (error) {
			if (!why) {
				if (error instanceof SandboxError) throw error;
				throw new SandboxError(`Agent37 command failed: ${error instanceof Error ? error.message : String(error)}`, {
					cause: error,
				});
			}
			// Dropping the request does not stop the command.
			// The shell on Debian does not accept "--" before a process group.
			await this.run(`kill -9 "-$(cat ${pidFile})"; rm -f ${pidFile}`, 20_000).catch(() => {});
			return stopped(why === "timeout");
		} finally {
			clearTimeout(timer);
			options.signal?.removeEventListener("abort", onAbort);
		}
	}

	private resolve(filePath: string) {
		return path.posix.resolve(this.workdir, filePath);
	}

	private async checked(script: string, action: string) {
		const reply = await this.run(script, 60_000);
		if (reply.exit_code !== 0) throw new SandboxError(`${action} failed: ${reply.stderr.trim()}`);
		return reply.stdout;
	}

	// There is no file API for a plain sandbox, so files travel through commands as base64.
	async readFile(requested: string): Promise<Uint8Array> {
		const file = quote(this.resolve(requested));
		const action = `Reading ${requested}`;
		const size = Number((await this.checked(`wc -c < ${file}`, action)).trim());
		if (size > MAX_OUTPUT_BYTES) {
			throw new SandboxError(`${action} failed: the file is larger than ${MAX_OUTPUT_BYTES} bytes`);
		}
		const chunks: Buffer[] = [];
		for (let at = 0; at < size; at += READ_CHUNK_BYTES) {
			const part = await this.checked(`tail -c +${at + 1} -- ${file} | head -c ${READ_CHUNK_BYTES} | base64`, action);
			chunks.push(Buffer.from(part, "base64"));
		}
		return new Uint8Array(Buffer.concat(chunks));
	}

	async writeFile(requested: string, content: string | Uint8Array): Promise<void> {
		const target = this.resolve(requested);
		const file = quote(target);
		const data = Buffer.from(content);
		const action = `Writing ${requested}`;
		// Collected beside the target first, so a failure never leaves half a file.
		const part = quote(`/tmp/.nf-write-${randomBytes(8).toString("hex")}`);
		let at = 0;
		do {
			const chunk = data.subarray(at, at + WRITE_CHUNK_BYTES).toString("base64");
			await this.checked(`printf %s '${chunk}' | base64 -d ${at === 0 ? ">" : ">>"} ${part}`, action);
			at += WRITE_CHUNK_BYTES;
		} while (at < data.length);
		// `cat` keeps an existing file's permissions.
		await this.checked(`mkdir -p -- "$(dirname -- ${file})" && cat ${part} > ${file} && rm -f ${part}`, action);
	}

	async destroy(): Promise<void> {
		if (this.destroyed) return;
		try {
			await call(this.connection, { method: "DELETE", url: `${API}/instances/${this.id}` });
		} catch (error) {
			if (!(error instanceof Agent37Error && error.status === 404)) throw error;
		}
		this.destroyed = true;
	}
}

const NO_ROOM = ["instance_limit_reached", "capacity_unavailable", "no_capacity", "try_again"];

export class Agent37Driver implements SandboxDriver {
	readonly name = "agent37";

	constructor(private options: Agent37Options) {}

	async create(options: CreateSandboxOptions = {}): Promise<Sandbox> {
		const workdir = options.workdir ?? DEFAULT_WORKDIR;
		const network =
			options.network === "none"
				? "deny-all"
				: options.allowedDomains
					? { allow: options.allowedDomains }
					: "allow-all";
		let id: string;
		try {
			({ id } = await call<{ id: string }>(this.options, {
				method: "POST",
				url: `${API}/instances`,
				// Waits until the machine is up.
				timeoutMs: 5 * 60_000,
				body: {
					// For this driver an image is the name of another template.
					template: options.image ?? this.options.template,
					resources: RESOURCES,
					network,
					name: LABEL,
					metadata: { app: LABEL },
					auto_sleep: true,
					idle_timeout_seconds: IDLE_SECONDS,
				},
			}));
		} catch (error) {
			const full = error instanceof Agent37Error && NO_ROOM.includes(error.code);
			const Failure = full ? SandboxCapacityError : SandboxError;
			const reason = error instanceof Error ? error.message : String(error);
			throw new Failure(`Could not create an Agent37 sandbox: ${reason}`, { cause: error });
		}
		const sandbox = new Agent37Sandbox(id, workdir, this.options);
		try {
			const made = await sandbox.run(`mkdir -p -- ${quote(workdir)}`, 2 * 60_000);
			if (made.exit_code !== 0) throw new SandboxError(`Cannot create ${workdir}: ${made.stderr.trim()}`);
		} catch (error) {
			await sandbox.destroy().catch(() => {});
			throw error;
		}
		return sandbox;
	}
}

type Listed = { id: string; created: number; metadata?: Record<string, unknown> | null };

/** Deletes sandboxes of ours older than any run can be, left behind by a worker that died. */
export async function destroyStaleAgent37(options: Connection & { olderThanMs: number; now?: number }) {
	const { data } = await call<{ data: Listed[] }>(options, { method: "GET", url: `${API}/instances` });
	const cutoff = (options.now ?? Date.now()) - options.olderThanMs;
	// "created" is in seconds. Anything not labelled as ours is left alone.
	const stale = data.filter((box) => box.metadata?.app === LABEL && box.created * 1000 < cutoff);
	let removed = 0;
	const failed: string[] = [];
	for (const box of stale) {
		try {
			await call(options, { method: "DELETE", url: `${API}/instances/${box.id}` });
			removed++;
		} catch (error) {
			failed.push(error instanceof Error ? error.message : String(error));
		}
	}
	return { removed, failed };
}

/** The names the build script gives the two images. Reads the Dockerfiles. */
export function agent37Templates() {
	const dir = findImageDir(path.dirname(fileURLToPath(import.meta.url)));
	return { plain: agent37Template(dir, "plain").name, browser: agent37Template(dir, "browser").name };
}
