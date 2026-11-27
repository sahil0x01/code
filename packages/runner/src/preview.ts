import { prepareWorkspace } from "@nullfuse/agent";
import { endPreview, keepPreview, loadPreviewContext, setPreviewReady } from "@nullfuse/db";
import { type Sandbox, SandboxCapacityError } from "@nullfuse/sandbox";
import type { RunnerDeps } from "./execute";
import { redactor } from "./redact";

export const PREVIEW_IDLE_MS = 10 * 60_000;
export const PREVIEW_MAX_MS = 30 * 60_000;

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 2 * 60_000;
const HEARTBEAT_MS = 15_000;
const LOG = "/tmp/nullfuse-preview.log";

export type PreviewOptions = {
	/** Waits between checks on a running preview. */
	pause(): Promise<unknown>;
	now?(): number;
	readyTimeoutMs?: number;
};

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

// Any answer counts: the app may well return 404 for "/".
const answers = (port: number) =>
	`node -e "fetch('http://127.0.0.1:${port}/').then(() => process.exit(0), () => process.exit(1))"`;

async function startApp(
	sandbox: Sandbox,
	command: string,
	port: number,
	env: Record<string, string>,
	timeoutMs: number,
) {
	// A marker file, because a dead process can linger in the process table and look alive.
	const script = `sh -c ${quote(command)}; : > ${LOG}.exit`;
	await sandbox.exec(`nohup sh -c ${quote(script)} > ${LOG} 2>&1 < /dev/null &`, { env });
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if ((await sandbox.exec(answers(port), { timeoutMs: 20_000 })).exitCode === 0) return;
		const running = (await sandbox.exec(`test ! -e ${LOG}.exit`)).exitCode === 0;
		if (!running || Date.now() > deadline) {
			const log = (await sandbox.exec(`tail -c 1500 ${LOG}`)).stdout.trim();
			const why = running ? "did not answer on its port in time" : "exited before it was ready";
			throw new Error(`The app ${why}.${log ? `\n${log}` : ""}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
}

/**
 * Starts the app from the chat's branch and keeps it up while someone is looking, for at
 * most `PREVIEW_MAX_MS`. The sandbox is always destroyed on the way out.
 */
export async function servePreview(
	deps: RunnerDeps,
	chatId: string,
	generation: string,
	options: PreviewOptions,
) {
	const now = options.now ?? Date.now;
	if (!(await keepPreview(deps.db, chatId, generation))) return;

	let sandbox: Sandbox | undefined;
	let clean = (text: string) => text;
	// Starting can take minutes, and the heartbeat shows the worker is still there.
	const heartbeat = setInterval(() => {
		keepPreview(deps.db, chatId, generation).catch(() => {});
	}, deps.heartbeatMs ?? HEARTBEAT_MS);
	try {
		const context = await loadPreviewContext(deps.db, chatId);
		const project = context?.project;
		if (!context || !project?.startCommand || project.appPort === null || project.installationId === null) {
			throw new Error("The project is not set up for previews.");
		}
		const env = Object.fromEntries(
			context.envVars.map((v) => [v.name, deps.decryptEnvValue(project.id, v.name, v.valueEncrypted)]),
		);
		clean = redactor(Object.values(env)).text;
		const repoUrl = deps.repoUrl?.(project.fullName) ?? `https://github.com/${project.fullName}.git`;
		const token =
			new URL(repoUrl).protocol === "https:"
				? await deps.githubToken({ installationId: project.installationId, repository: project.fullName })
				: undefined;

		sandbox = await deps.driver.create({ image: deps.image });
		if (!sandbox.previewUrl) throw new Error("Previews need the Daytona sandbox driver.");
		await prepareWorkspace(sandbox, {
			repoUrl,
			baseBranch: context.baseBranch,
			workingBranch: context.workingBranch ?? context.baseBranch,
			author: deps.author,
			token,
		});
		if (project.installCommand) {
			const setup = await sandbox.exec(project.installCommand, { env, timeoutMs: INSTALL_TIMEOUT_MS });
			if (setup.exitCode !== 0 || setup.timedOut) {
				throw new Error(`The setup command failed.\n${`${setup.stdout}${setup.stderr}`.trim().slice(-1500)}`);
			}
		}
		await startApp(sandbox, project.startCommand, project.appPort, env, options.readyTimeoutMs ?? READY_TIMEOUT_MS);

		const started = now();
		const url = await sandbox.previewUrl(project.appPort, PREVIEW_MAX_MS / 1000);
		const ready = { url, expiresAt: new Date(started + PREVIEW_MAX_MS) };
		if (!(await setPreviewReady(deps.db, chatId, generation, ready))) return;
		clearInterval(heartbeat);

		for (;;) {
			await options.pause();
			const state = await keepPreview(deps.db, chatId, generation);
			if (!state) return;
			if (now() - started >= PREVIEW_MAX_MS || now() - state.lastSeenAt.getTime() >= PREVIEW_IDLE_MS) break;
			// Also counts as activity, so the provider does not stop the sandbox by itself.
			if ((await sandbox.exec(answers(project.appPort), { timeoutMs: 20_000 })).exitCode !== 0) {
				throw new Error("The app stopped answering.");
			}
		}
		await endPreview(deps.db, chatId, generation, { status: "stopped" });
	} catch (error) {
		const message =
			error instanceof SandboxCapacityError
				? "There is no free sandbox right now. Try again in a minute."
				: clean(error instanceof Error ? error.message : String(error)).slice(0, 2000);
		await endPreview(deps.db, chatId, generation, { status: "failed", error: message });
	} finally {
		clearInterval(heartbeat);
		await sandbox?.destroy();
	}
}
