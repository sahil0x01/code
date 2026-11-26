import type { Sandbox } from "@nullfuse/sandbox";
import { shellQuote } from "./shell";

export class WorkspaceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkspaceError";
	}
}

export type WorkspaceSpec = {
	/** Always passed to git explicitly; the repository's own remotes are never used. */
	repoUrl: string;
	baseBranch: string;
	workingBranch: string;
	author: { name: string; email: string };
	/** GitHub installation token. Only sent with git commands that use the network. */
	token?: string;
};

export type SaveResult =
	| { saved: true; committed: boolean; sha: string }
	| { saved: false; reason: "too_large"; files: number; bytes: number };

export const MAX_COMMIT_BYTES = 50_000_000;
export const MAX_COMMIT_FILES = 5_000;

const LOCAL_TIMEOUT_MS = 60_000;
const NETWORK_TIMEOUT_MS = 10 * 60_000;

// The agent runs code that can edit .git/config and .git/hooks, so ours override them.
const SAFE_CONFIG = [
	"core.hooksPath=/dev/null",
	"core.fsmonitor=false",
	"core.sshCommand=false",
	"credential.helper=",
	"commit.gpgsign=false",
	"http.proxy=",
	"http.sslVerify=true",
]
	.map((setting) => `-c ${shellQuote(setting)}`)
	.join(" ");

export function workingBranchFor(chatId: string) {
	return `nullfuse/chat-${chatId.slice(0, 8)}`;
}

// The token travels in git's environment, scoped to the repository's host. It is
// never in a command line, never written to .git/config, and never in the
// environment of the agent's own commands.
function networkEnv(spec: WorkspaceSpec) {
	const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0" };
	if (spec.token === undefined) return env;

	const url = new URL(spec.repoUrl);
	if (url.protocol !== "https:") {
		throw new WorkspaceError("A token is only sent over https.");
	}
	const basic = Buffer.from(`x-access-token:${spec.token}`).toString("base64");
	env.GIT_CONFIG_COUNT = "1";
	env.GIT_CONFIG_KEY_0 = `http.${url.origin}/.extraheader`;
	env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${basic}`;
	return env;
}

async function git(
	sandbox: Sandbox,
	args: string,
	options: { spec?: WorkspaceSpec } = {},
) {
	const env = options.spec ? networkEnv(options.spec) : { GIT_TERMINAL_PROMPT: "0" };
	return sandbox.exec(`git ${SAFE_CONFIG} ${args}`, {
		env,
		timeoutMs: options.spec ? NETWORK_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
	});
}

async function mustGit(sandbox: Sandbox, args: string, options: { spec?: WorkspaceSpec } = {}) {
	const result = await git(sandbox, args, options);
	if (result.exitCode !== 0) {
		const detail = result.timedOut ? "timed out" : result.stderr.trim() || `exit code ${result.exitCode}`;
		throw new WorkspaceError(`git ${args.split(" ")[0]} failed: ${detail}`);
	}
	return result;
}

/** Clones the repository into the workdir, resuming the working branch if it exists. */
export async function prepareWorkspace(sandbox: Sandbox, spec: WorkspaceSpec) {
	const q = shellQuote;
	const listed = await mustGit(
		sandbox,
		`ls-remote --heads -- ${q(spec.repoUrl)} ${q(`refs/heads/${spec.workingBranch}`)}`,
		{ spec },
	);
	const resumed = listed.stdout.trim() !== "";

	await mustGit(
		sandbox,
		`clone --depth 1 --branch ${q(resumed ? spec.workingBranch : spec.baseBranch)} -- ${q(spec.repoUrl)} .`,
		{ spec },
	);
	await mustGit(sandbox, `config user.name ${q(spec.author.name)}`);
	await mustGit(sandbox, `config user.email ${q(spec.author.email)}`);
	if (!resumed) await mustGit(sandbox, `checkout -b ${q(spec.workingBranch)}`);

	const head = await mustGit(sandbox, "rev-parse HEAD");
	return { resumed, headSha: head.stdout.trim() };
}

/** Commits everything as work in progress and pushes it to the working branch. */
export async function saveProgress(
	sandbox: Sandbox,
	spec: WorkspaceSpec,
	message = "WIP: save progress",
): Promise<SaveResult> {
	const q = shellQuote;
	await mustGit(sandbox, "add -A");

	const staged = `git ${SAFE_CONFIG} diff --cached --name-only --diff-filter=AMR`;
	const files = Number((await sandbox.exec(`${staged} | wc -l`)).stdout.trim());
	const bytes = Number(
		(
			await sandbox.exec(
				`${staged} -z | xargs -0 -r du -cb | awk '$2=="total"{s+=$1} END{print s+0}'`,
			)
		).stdout.trim(),
	);
	if (files > MAX_COMMIT_FILES || bytes > MAX_COMMIT_BYTES) {
		await mustGit(sandbox, "reset -q");
		return { saved: false, reason: "too_large", files, bytes };
	}

	const changes = await git(sandbox, "diff --cached --quiet");
	if (changes.exitCode !== 0 && changes.exitCode !== 1) {
		throw new WorkspaceError(`git diff failed: ${changes.stderr.trim()}`);
	}
	const committed = changes.exitCode === 1;
	if (committed) {
		await mustGit(
			sandbox,
			`-c user.name=${q(spec.author.name)} -c user.email=${q(spec.author.email)} commit -q -m ${q(message)}`,
		);
	}

	await mustGit(sandbox, `push -- ${q(spec.repoUrl)} HEAD:${q(`refs/heads/${spec.workingBranch}`)}`, {
		spec,
	});
	const head = await mustGit(sandbox, "rev-parse HEAD");
	return { saved: true, committed, sha: head.stdout.trim() };
}

// Same shape as `ChangedFile` in @nullfuse/db, which this package does not import.
export type ChangedFile = {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
};

export const MAX_CHANGED_FILES = 200;

export function parseStatus(output: string): ChangedFile[] {
	const parts = output.split("\0");
	const files: ChangedFile[] = [];
	for (let index = 0; index < parts.length; index++) {
		const entry = parts[index] ?? "";
		if (entry.length < 4) continue;

		const code = entry.slice(0, 2);
		const path = entry.slice(3);
		// Renames and copies are followed by the original path.
		if (code.includes("R") || code.includes("C")) index++;

		let status: ChangedFile["status"] = "modified";
		if (code === "??" || code.includes("A")) status = "added";
		else if (code.includes("D")) status = "deleted";
		else if (code.includes("R") || code.includes("C")) status = "renamed";
		files.push({ path, status });
	}
	return files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, MAX_CHANGED_FILES);
}

/** Uncommitted changes in the workspace: what the current run has done so far. */
export async function changedFiles(sandbox: Sandbox) {
	const result = await mustGit(sandbox, "status --porcelain=v1 -z -uall");
	return parseStatus(result.stdout);
}
