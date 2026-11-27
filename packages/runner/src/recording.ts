import { randomBytes } from "node:crypto";
import { readText, recordingHarness, type Sandbox } from "@nullfuse/sandbox";

const START_TIMEOUT_MS = 90_000;
const SCRIPT_TIMEOUT_MS = 60_000;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
// Browser start-up and saving the video, on top of the two limits above.
const OVERHEAD_MS = 60_000;

const skipReasons = {
	bad_script: "The recording script could not be loaded.",
	port_in_use: "Something was already using the app port.",
	app_exited: "The start command exited before the app was ready.",
	app_not_ready: "The app did not answer on its port in time.",
	video_too_large: "The video was too large to keep.",
	browser_failed: "The browser could not record the work.",
	timed_out: "Recording took too long.",
	no_result: "Recording stopped without a result.",
} as const;

export type Recording =
	| {
			status: "recorded";
			/** Where the video is inside the sandbox. */
			path: string;
			/** Whether the script's own checks passed. */
			passed: boolean;
			error: string | null;
			durationMs: number;
			bytes: number;
			/** Screenshots, also inside the sandbox. */
			shots: { path: string; label: string }[];
	  }
	| { status: "skipped"; reason: keyof typeof skipReasons; message: string; detail: string };

export type RecordingRequest = {
	startCommand: string;
	port: number;
	/** A module whose default export drives the page: `({ page, expect, baseURL }) => {}`. */
	script: string;
	env?: Record<string, string>;
	signal?: AbortSignal;
	startTimeoutMs?: number;
	scriptTimeoutMs?: number;
	maxBytes?: number;
};

function skipped(reason: keyof typeof skipReasons, detail = ""): Recording {
	return { status: "skipped", reason, message: skipReasons[reason], detail };
}

// The file is written by code running in the sandbox, so nothing in it is taken on trust.
export function parseResult(text: string, videoPath: string): Recording {
	let value: Record<string, unknown>;
	try {
		value = Object(JSON.parse(text));
	} catch {
		return skipped("no_result");
	}
	const { status, reason, detail, passed, error, durationMs, bytes, shots } = value;
	const folder = videoPath.slice(0, videoPath.lastIndexOf("/"));
	if (status === "recorded" && typeof passed === "boolean") {
		return {
			status,
			path: videoPath,
			passed,
			error: typeof error === "string" ? error.slice(0, 2000) : null,
			durationMs: Number(durationMs) || 0,
			bytes: Number(bytes) || 0,
			// Only names the harness itself would choose, so nothing else can be uploaded.
			shots: (Array.isArray(shots) ? shots : []).slice(0, 4).flatMap((shot) => {
				const { file, label } = Object(shot);
				return typeof file === "string" && /^shot-[1-4]\.png$/.test(file)
					? [{ path: `${folder}/${file}`, label: typeof label === "string" ? label.slice(0, 200) : "" }]
					: [];
			}),
		};
	}
	if (status === "skipped" && typeof reason === "string" && Object.hasOwn(skipReasons, reason)) {
		return skipped(
			reason as keyof typeof skipReasons,
			typeof detail === "string" ? detail.slice(-2000) : "",
		);
	}
	return skipped("no_result");
}

type HarnessRequest = Omit<RecordingRequest, "script" | "startCommand" | "port"> & {
	startCommand?: string;
	port?: number;
	script?: string;
	mode?: "check" | "page";
	path?: string;
	/** HTML to record in "page" mode. */
	html?: string;
};

/** Runs the harness once and returns the text of its result file, or why there is none. */
export async function runHarness(sandbox: Sandbox, request: HarnessRequest) {
	// Outside the workspace, so none of this is committed with the change.
	const base = `/tmp/nullfuse-recording-${randomBytes(6).toString("hex")}`;
	const outDir = `${base}/out`;
	const startTimeoutMs = request.startTimeoutMs ?? START_TIMEOUT_MS;
	const scriptTimeoutMs = request.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS;
	const script = request.script === undefined ? undefined : `${base}/script.mjs`;

	const harness = `${base}/record.mjs`;
	await sandbox.writeFile(harness, recordingHarness());
	if (script) await sandbox.writeFile(script, request.script ?? "");
	const page = request.html === undefined ? undefined : `${base}/page.html`;
	if (page) await sandbox.writeFile(page, request.html ?? "");
	await sandbox.writeFile(
		`${base}/spec.json`,
		JSON.stringify({
			mode: request.mode,
			path: request.path,
			page,
			startCommand: request.startCommand,
			port: request.port,
			workdir: sandbox.workdir,
			script,
			outDir,
			startTimeoutMs,
			scriptTimeoutMs,
			maxBytes: request.maxBytes ?? MAX_VIDEO_BYTES,
		}),
	);

	const run = await sandbox.exec(`node ${harness} ${base}/spec.json`, {
		env: request.env,
		signal: request.signal,
		timeoutMs: startTimeoutMs + scriptTimeoutMs + OVERHEAD_MS,
	});
	if (run.timedOut) return { ok: false as const, skipped: skipped("timed_out") };

	try {
		const text = await readText(sandbox, `${outDir}/result.json`);
		return { ok: true as const, text, outDir };
	} catch {
		return { ok: false as const, skipped: skipped("no_result", run.stderr) };
	}
}

/** Records the app in a sandbox made from the recording image. Never throws for the app's own failures. */
export async function recordChange(sandbox: Sandbox, request: RecordingRequest): Promise<Recording> {
	const run = await runHarness(sandbox, request);
	return run.ok ? parseResult(run.text, `${run.outDir}/video.webm`) : run.skipped;
}

/** Records a prepared HTML page: a video of reading it and a screenshot of all of it. */
export async function recordPage(sandbox: Sandbox, html: string, signal?: AbortSignal) {
	const run = await runHarness(sandbox, { mode: "page", html, signal });
	return run.ok ? parseResult(run.text, `${run.outDir}/video.webm`) : run.skipped;
}

/** Where the agent is asked to leave its script: outside the workspace, so it is never committed. */
export const SCRIPT_PATH = "/tmp/nullfuse-record/script.mjs";

/** Sends a file straight from the sandbox, which only ever sees a link for this one object. */
export async function uploadFile(
	sandbox: Sandbox,
	path: string,
	url: string,
	type: "video/webm" | "image/png",
	signal?: AbortSignal,
) {
	const result = await sandbox.exec(
		`curl -fsS --max-time 120 -X PUT -H "content-type: ${type}" --upload-file '${path}' "$UPLOAD_URL" >/dev/null`,
		{ env: { UPLOAD_URL: url }, signal, timeoutMs: 130_000 },
	);
	if (result.exitCode === 0 && !result.timedOut) return null;
	return result.stderr.replaceAll(url, "[upload link]").trim().slice(-500) || "The upload failed.";
}
