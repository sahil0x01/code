export const DEFAULT_EXEC_TIMEOUT_MS = 120_000;
export const MAX_OUTPUT_BYTES = 1_000_000;

export type ExecOptions = {
	cwd?: string;
	env?: Record<string, string>;
	/** Kills every process in the sandbox when it expires. */
	timeoutMs?: number;
	input?: string;
	/** Aborting kills every process in the sandbox, like a timeout does. */
	signal?: AbortSignal;
};

export type ExecResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	/** stdout or stderr was cut at MAX_OUTPUT_BYTES. */
	truncated: boolean;
};

export type CreateSandboxOptions = {
	image?: string;
	workdir?: string;
	memoryMb?: number;
	cpus?: number;
	pidsLimit?: number;
	network?: "default" | "none";
};

export interface Sandbox {
	readonly id: string;
	readonly workdir: string;
	exec(command: string, options?: ExecOptions): Promise<ExecResult>;
	/** Throws if the file is larger than MAX_OUTPUT_BYTES. */
	readFile(path: string): Promise<Uint8Array>;
	writeFile(path: string, content: string | Uint8Array): Promise<void>;
	/** Safe to call twice. */
	destroy(): Promise<void>;
}

export interface SandboxDriver {
	readonly name: string;
	create(options?: CreateSandboxOptions): Promise<Sandbox>;
}

/** The sandbox itself failed, not a command inside it. */
export class SandboxError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "SandboxError";
	}
}
