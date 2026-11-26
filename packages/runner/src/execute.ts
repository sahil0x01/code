import {
	type AgentLimits,
	type AgentRun,
	changedFiles,
	DEFAULT_LIMITS,
	prepareWorkspace,
	runAgent,
	SYSTEM_PROMPT,
	saveProgress,
	toStepRecord,
	type WorkspaceSpec,
	workingBranchFor,
} from "@nullfuse/agent";
import {
	type ClaimResult,
	claimRun,
	type Db,
	finishRun,
	getRunProgress,
	isStopRequested,
	loadRunContext,
	type RunContext,
	type RunOutcome,
	type RunVerification,
	recordStep,
	setChangedFiles,
	setPullRequest,
	setPullRequestError,
	setVerification,
	setWorkingBranchIfUnset,
	touchRun,
} from "@nullfuse/db";
import type { Sandbox, SandboxDriver } from "@nullfuse/sandbox";
import type { LanguageModel } from "ai";
import { redactor } from "./redact";

export type RunnerDeps = {
	db: Db;
	driver: SandboxDriver;
	image?: string;
	/** Turns the model name saved on the run into a model. */
	createModel(modelKey: string): LanguageModel;
	/** A token for git over https, limited to this repository. */
	githubToken(input: { installationId: number; repository: string }): Promise<string>;
	decryptEnvValue(projectId: string, name: string, stored: string): string;
	author: { name: string; email: string };
	repoUrl?(fullName: string): string;
	limits?: Partial<AgentLimits>;
	/** How often a running run checks whether the user asked to stop it. */
	stopPollMs?: number;
	/** How often a running run tells the database it is alive. */
	heartbeatMs?: number;
	/** Save the work to the branch after this many steps, so a crash loses little. */
	checkpointEverySteps?: number;
	/** The run fails when the workspace is bigger than this. */
	maxDiskMb?: number;
	maxRunningPerUser?: number;
	/** Opens the chat's PR. Returns null when the branch has nothing to propose yet. */
	openPullRequest?(input: PullRequestInput): Promise<{ number: number; url: string } | null>;
};

export type PullRequestInput = {
	installationId: number;
	repository: string;
	head: string;
	base: string;
	title: string;
	body: string;
};

export type ExecuteResult =
	| { claimed: false; reason: Extract<ClaimResult, { ok: false }>["reason"] }
	| { claimed: true; status: RunOutcome["status"]; stopReason: RunOutcome["stopReason"] };

const SETUP_TIMEOUT_MS = 10 * 60_000;
const VERIFY_TIMEOUT_MS = 10 * 60_000;
const VERIFY_OUTPUT_CHARS = 4000;
const DEFAULT_HEARTBEAT_MS = 15_000;
const DEFAULT_CHECKPOINT_STEPS = 5;
const DEFAULT_MAX_DISK_MB = 2048;

function describe(error: unknown) {
	const text = error instanceof Error ? error.message : String(error);
	return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function failed(error: string): RunOutcome {
	return { status: "failed", stopReason: "error", error };
}

async function runSetup(
	sandbox: Sandbox,
	command: string,
	env: Record<string, string>,
	signal: AbortSignal,
) {
	const result = await sandbox.exec(command, { env, timeoutMs: SETUP_TIMEOUT_MS, signal });
	if (result.exitCode === 0 && !result.timedOut) {
		return `Dependencies were set up with \`${command}\`.`;
	}
	const tail = `${result.stdout}${result.stderr}`.trim().slice(-1500);
	const why = result.timedOut ? "timed out" : `failed (exit code ${result.exitCode})`;
	return `The setup command \`${command}\` ${why}. Its output ended with:\n${tail}`;
}

function instructionsFor(
	context: RunContext,
	branch: string,
	setup: string | undefined,
	resumed: boolean,
) {
	const lines = [
		SYSTEM_PROMPT,
		"",
		`Project: ${context.project.fullName}. You are on the branch ${branch}, started from ${context.chat.baseBranch}. Your changes are saved to this branch automatically when you finish; do not push or switch branches.`,
	];
	if (context.project.testCommand) lines.push(`To run the tests: ${context.project.testCommand}`);
	if (setup) lines.push(setup);
	if (resumed) {
		lines.push(
			"This task was interrupted and restarted. Your earlier work is on the branch; check `git status` and `git diff` to see where you left off, then continue instead of starting over.",
		);
	}
	return lines.join("\n");
}

function commitMessage(context: RunContext) {
	const last = context.messages.filter((m) => m.role === "user").at(-1)?.content ?? "";
	const title = (last.trim().split("\n")[0] ?? "").slice(0, 60);
	return title ? `WIP: ${title}` : "WIP: save progress";
}

function pullRequestTitle(context: RunContext) {
	const first = context.messages.find((m) => m.role === "user")?.content ?? "";
	const line = (first.trim().split("\n")[0] ?? "").trim();
	const title = line.length > 72 ? `${line.slice(0, 69)}...` : line;
	return title || "Changes from Code by NullFuse";
}

function pullRequestBody(answer: string, files: { path: string; status: string }[], verification?: RunVerification) {
	const parts = [answer.trim() || "Changes made by the agent."];
	if (files.length > 0) {
		const shown = files.slice(0, 50).map((file) => `- \`${file.path}\` (${file.status})`);
		if (files.length > shown.length) shown.push(`- and ${files.length - shown.length} more`);
		parts.push(`### Files changed\n${shown.join("\n")}`);
	}
	if (verification) {
		const passed = verification.exitCode === 0 && !verification.timedOut;
		const how = verification.timedOut ? "timed out" : `exit code ${verification.exitCode}`;
		parts.push(`### Tests\n${passed ? "Passed" : "Failed"} (\`${verification.command}\`, ${how}).`);
	}
	parts.push("---\nOpened by Code by NullFuse. Review the changes before merging.");
	return parts.join("\n\n");
}

function outcomeFor(agent: AgentRun): RunOutcome {
	const base = { stopReason: agent.stoppedBy, text: agent.text };
	switch (agent.stoppedBy) {
		case "completed":
			return { ...base, status: "succeeded" };
		case "aborted":
			return { ...base, status: "cancelled" };
		case "step-limit":
			return { ...base, status: "failed", error: "Stopped: reached the step limit." };
		case "token-budget":
			return { ...base, status: "failed", error: "Stopped: reached the token budget." };
		case "timeout":
			return { ...base, status: "failed", error: "Stopped: ran out of time." };
	}
}

async function perform(
	deps: RunnerDeps,
	runId: string,
	attempt: number,
	signal: AbortSignal | undefined,
	track: (sandbox: Sandbox) => void,
	fence: { superseded: boolean },
): Promise<RunOutcome> {
	const context = await loadRunContext(deps.db, runId);
	if (!context) return failed("The chat no longer exists.");
	const { project, chat } = context;
	if (project.installationId === null) {
		return failed("The project is disconnected from GitHub. Reconnect it and send the message again.");
	}

	const branch = workingBranchFor(chat.id);
	await setWorkingBranchIfUnset(deps.db, chat.id, branch);

	const env = Object.fromEntries(
		context.envVars.map((v) => [v.name, deps.decryptEnvValue(project.id, v.name, v.valueEncrypted)]),
	);
	const redact = redactor(Object.values(env));
	const clean = (outcome: RunOutcome): RunOutcome => ({
		...outcome,
		...(outcome.text !== undefined && { text: redact.text(outcome.text) }),
		...(outcome.error !== undefined && { error: redact.text(outcome.error) }),
	});
	const repoUrl = deps.repoUrl?.(project.fullName) ?? `https://github.com/${project.fullName}.git`;
	const token =
		new URL(repoUrl).protocol === "https:"
			? await deps.githubToken({ installationId: project.installationId, repository: project.fullName })
			: undefined;
	const spec: WorkspaceSpec = {
		repoUrl,
		baseBranch: chat.baseBranch,
		workingBranch: branch,
		author: deps.author,
		token,
	};

	const limits = { ...DEFAULT_LIMITS, ...deps.limits };
	const before = await getRunProgress(deps.db, runId);
	if (before.steps >= limits.maxSteps) {
		return { status: "failed", stopReason: "step-limit", error: "Stopped: reached the step limit." };
	}
	if (before.tokens >= limits.maxTokens) {
		return { status: "failed", stopReason: "token-budget", error: "Stopped: reached the token budget." };
	}

	const sandbox = await deps.driver.create({ image: deps.image });
	track(sandbox);
	await prepareWorkspace(sandbox, spec);

	// A Stop is a flag in the database, so it works whatever runs the job.
	const stop = new AbortController();
	let diskExceeded = false;
	const maxDiskMb = deps.maxDiskMb ?? DEFAULT_MAX_DISK_MB;
	let polling = false;
	const poll = setInterval(async () => {
		if (polling) return;
		polling = true;
		try {
			if (await isStopRequested(deps.db, runId)) stop.abort();
		} catch {
			// Checked again on the next tick.
		} finally {
			polling = false;
		}
	}, deps.stopPollMs ?? 1000);
	// A newer attempt owns the run now, so this one must stop touching it.
	let beating = false;
	const heartbeat = setInterval(async () => {
		if (beating) return;
		beating = true;
		try {
			if (!(await touchRun(deps.db, runId, attempt))) {
				fence.superseded = true;
				stop.abort();
			}
		} catch {
			// Retried on the next beat; a database outage is the sweeper's problem.
		} finally {
			beating = false;
		}
	}, deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
	const abort = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;

	let lastFiles: Awaited<ReturnType<typeof changedFiles>> = [];
	let verification: RunVerification | undefined;
	const syncFiles = async () => {
		try {
			lastFiles = await changedFiles(sandbox);
			await setChangedFiles(deps.db, runId, lastFiles, attempt);
		} catch {
			// The list is shown again after the next step.
		}
	};

	const checkDisk = async () => {
		const used = await sandbox.exec("du -sk .", { timeoutMs: 30_000 });
		const kb = Number.parseInt(used.stdout, 10);
		if (Number.isFinite(kb) && kb / 1024 > maxDiskMb) {
			diskExceeded = true;
			stop.abort();
		}
	};

	// Recorded on the run, never changes its status: the user decides what a red test means.
	const verify = async (command: string, signal: AbortSignal) => {
		if (signal.aborted) return;
		const started = Date.now();
		const result = await sandbox.exec(command, { env, timeoutMs: VERIFY_TIMEOUT_MS, signal });
		if (signal.aborted && !result.timedOut) return;
		const output = redact.text(`${result.stdout}${result.stderr}`.trim());
		verification = {
			command,
			exitCode: result.exitCode,
			timedOut: result.timedOut,
			durationMs: Date.now() - started,
			output: output.length > VERIFY_OUTPUT_CHARS ? `...${output.slice(-VERIFY_OUTPUT_CHARS)}` : output,
		};
		await setVerification(deps.db, runId, verification, attempt);
	};

	let sinceCheckpoint = 0;
	const checkpoint = async () => {
		if (++sinceCheckpoint < (deps.checkpointEverySteps ?? DEFAULT_CHECKPOINT_STEPS)) return;
		sinceCheckpoint = 0;
		try {
			await saveProgress(sandbox, spec, commitMessage(context));
		} catch {
			// The final save reports a real problem; a missed checkpoint only risks more rework.
		}
	};

	let agent: AgentRun | undefined;
	let agentError: unknown;
	try {
		const setup = project.installCommand
			? await runSetup(sandbox, project.installCommand, env, abort)
			: undefined;
		try {
			await checkDisk();
			agent = await runAgent({
				model: deps.createModel(context.run.model),
				sandbox,
				messages: context.messages,
				env,
				instructions: instructionsFor(context, branch, setup, before.steps > 0),
				limits: {
					...deps.limits,
					maxSteps: limits.maxSteps - before.steps,
					maxTokens: limits.maxTokens - before.tokens,
				},
				signal: abort,
				onStep: async (step) => {
					const record = redact.step(toStepRecord(step));
					await recordStep(
						deps.db,
						runId,
						{ ...record, stepIndex: record.stepIndex + before.steps },
						attempt,
					);
					await syncFiles();
					await checkDisk();
					await checkpoint();
				},
			});
			if (context.run.verify && project.testCommand && !diskExceeded && !fence.superseded) {
				await verify(project.testCommand, abort);
			}
		} catch (error) {
			agentError = error;
		}
	} finally {
		clearInterval(poll);
		clearInterval(heartbeat);
	}
	// A hung worker can wake up after the run moved on; it must not save over the new attempt.
	if (!fence.superseded && !(await touchRun(deps.db, runId, attempt).catch(() => true))) {
		fence.superseded = true;
	}
	if (fence.superseded) return failed("This attempt was replaced by a newer one.");
	await syncFiles();

	if (diskExceeded) {
		agentError = new Error(`Stopped: the workspace grew past ${maxDiskMb} MB.`);
	}

	// Whatever happened, keep the work done so far.
	let saveError: string | undefined;
	try {
		const saved = await saveProgress(sandbox, spec, commitMessage(context));
		if (!saved.saved) {
			saveError = `The changes were not saved: ${saved.files} files and ${saved.bytes} bytes are too many to commit. Add generated folders to .gitignore.`;
		}
	} catch (error) {
		saveError = `The work could not be saved to GitHub: ${describe(error)}`;
	}

	// A PR failing must not fail the run: the work is saved, and the page says why.
	if (saveError === undefined && deps.openPullRequest && chat.pullRequestNumber === null) {
		try {
			const pr = await deps.openPullRequest({
				installationId: project.installationId,
				repository: project.fullName,
				head: branch,
				base: chat.baseBranch,
				title: redact.text(pullRequestTitle(context)),
				body: redact.text(pullRequestBody(agent?.text ?? "", lastFiles, verification)),
			});
			if (pr) await setPullRequest(deps.db, chat.id, pr);
		} catch (error) {
			await setPullRequestError(deps.db, chat.id, describe(error)).catch(() => {});
		}
	}

	if (agentError !== undefined || !agent) {
		return clean(failed([describe(agentError), saveError].filter(Boolean).join(" ")));
	}
	const outcome = outcomeFor(agent);
	if (saveError === undefined) return clean(outcome);
	return clean({
		...outcome,
		status: outcome.status === "cancelled" ? "cancelled" : "failed",
		stopReason: outcome.status === "cancelled" ? outcome.stopReason : "error",
		error: [outcome.error, saveError].filter(Boolean).join(" "),
	});
}

export async function executeRun(
	deps: RunnerDeps,
	runId: string,
	options: { signal?: AbortSignal } = {},
): Promise<ExecuteResult> {
	const claim = await claimRun(deps.db, runId, { maxRunningPerUser: deps.maxRunningPerUser });
	if (!claim.ok) return { claimed: false, reason: claim.reason };
	const { attempt } = claim.run;

	let sandbox: Sandbox | undefined;
	let outcome: RunOutcome;
	const fence = { superseded: false };
	try {
		outcome = await perform(
			deps,
			runId,
			attempt,
			options.signal,
			(created) => {
				sandbox = created;
			},
			fence,
		);
	} catch (error) {
		outcome = failed(describe(error));
	} finally {
		await sandbox?.destroy();
	}

	await finishRun(deps.db, runId, outcome, attempt);
	return { claimed: true, status: outcome.status, stopReason: outcome.stopReason };
}
