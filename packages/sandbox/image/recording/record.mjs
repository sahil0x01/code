// Runs inside the sandbox: starts the app and drives it with the agent's script, either to
// record a video and screenshots or (mode "check") to report what the page shows and any
// errors. Mode "page" records a prepared HTML page, with no app.
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const spec = JSON.parse(await readFile(process.argv[2], "utf8"));
const baseURL = `http://localhost:${spec.port}`;
const video = `${spec.outDir}/video.webm`;
const SIZE = { width: 1280, height: 720 };
const checking = spec.mode === "check";
const showing = spec.mode === "page";
const MAX_PROBLEMS = 20;
const MAX_SHOTS = 3;
const MAX_SHOT_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_HEIGHT = 6000;

let app;
let appLog = "";

function stopApp() {
	if (!app?.pid) return;
	try {
		// The whole process group, so dev servers do not leave children behind.
		process.kill(-app.pid, "SIGKILL");
	} catch {}
}

async function finish(result) {
	stopApp();
	await writeFile(`${spec.outDir}/result.json`, JSON.stringify(result));
	process.exit(0);
}

const skip = (reason, detail = "") => finish({ status: "skipped", reason, detail: detail.slice(-2000) });

const message = (error) => String(error?.message ?? error).slice(0, 2000);

async function answers() {
	try {
		await fetch(baseURL, { signal: AbortSignal.timeout(2000), redirect: "manual" });
		return true;
	} catch {
		return false;
	}
}

function within(ms, promise) {
	let timer;
	const limit = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(`The script took longer than ${ms} ms`)), ms);
	});
	return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

await rm(spec.outDir, { recursive: true, force: true });
await mkdir(spec.outDir, { recursive: true });

// Absolute, because this file is not inside the folder Playwright is installed in.
const { chromium, expect } = await import("/opt/nullfuse/node_modules/@playwright/test/index.mjs");

let script;
if (spec.script) {
	try {
		script = (await import(pathToFileURL(spec.script).href)).default;
		if (typeof script !== "function") throw new Error("The script needs a default export function");
	} catch (error) {
		await skip("bad_script", message(error));
	}
}

async function startApp() {
	// Something already listening would be recorded in place of this change.
	if (await answers()) await skip("port_in_use");

	let exited = false;
	app = spawn("sh", ["-c", spec.startCommand], {
		cwd: spec.workdir,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	for (const stream of [app.stdout, app.stderr]) {
		stream.on("data", (chunk) => {
			appLog = (appLog + chunk).slice(-4000);
		});
	}
	app.on("exit", () => {
		exited = true;
	});

	const deadline = Date.now() + spec.startTimeoutMs;
	while (!(await answers())) {
		if (exited) await skip("app_exited", appLog);
		if (Date.now() > deadline) await skip("app_not_ready", appLog);
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

if (!showing) await startApp();

const shots = [];
async function screenshot(page, label, options) {
	const file = `shot-${shots.length + 1}.png`;
	await page.screenshot({ path: `${spec.outDir}/${file}`, ...options });
	if ((await stat(`${spec.outDir}/${file}`)).size <= MAX_SHOT_BYTES) {
		shots.push({ file, label: String(label ?? "").slice(0, 200) });
	}
}

// Reads the prepared page from top to bottom, slowly enough to follow.
async function show(page) {
	await page.setContent(await readFile(spec.page, "utf8"));
	const height = await page.evaluate(() => document.documentElement.scrollHeight);
	await screenshot(page, "The whole record", {
		fullPage: true,
		clip: { x: 0, y: 0, width: SIZE.width, height: Math.min(height, MAX_PAGE_HEIGHT) },
	});
	await page.waitForTimeout(1500);
	const steps = Math.min(30, Math.ceil(Math.max(0, height - SIZE.height) / 300));
	for (let step = 0; step < steps; step++) {
		await page.mouse.wheel(0, 300);
		await page.waitForTimeout(400);
	}
}

try {
	const browser = await chromium.launch({
		args: ["--disable-dev-shm-usage"],
		// A script runs faster than a person can watch.
		...(!checking && !showing && { slowMo: 350 }),
	});
	const context = await browser.newContext({
		baseURL,
		viewport: SIZE,
		...(!checking && { recordVideo: { dir: spec.outDir, size: SIZE } }),
	});
	const page = await context.newPage();
	page.setDefaultTimeout(10_000);

	const consoleProblems = [];
	const networkProblems = [];
	const note = (list, text) => {
		if (list.length < MAX_PROBLEMS) list.push(String(text).slice(0, 500));
	};
	page.on("console", (entry) => {
		if (["error", "warning"].includes(entry.type())) note(consoleProblems, `${entry.type()}: ${entry.text()}`);
	});
	page.on("pageerror", (error) => note(consoleProblems, `uncaught: ${error.message}`));
	page.on("requestfailed", (request) =>
		note(networkProblems, `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`),
	);
	page.on("response", (response) => {
		if (response.status() >= 400) note(networkProblems, `${response.status()} ${response.url()}`);
	});

	const started = Date.now();
	let failure = null;
	try {
		// The last screenshot is always of the end state, so one is kept free for it.
		const shot = async (label) => {
			if (!checking && shots.length < MAX_SHOTS) await screenshot(page, label);
		};
		const work = showing
			? show(page)
			: script
				? script({ page, expect, baseURL, shot })
				: page.goto(spec.path ?? "/");
		await within(spec.scriptTimeoutMs, work);
		// Leaves the final state on screen long enough to see it.
		await page.waitForTimeout(1500);
	} catch (error) {
		failure = message(error);
	}
	const durationMs = Date.now() - started;

	if (checking) {
		const url = page.url();
		const snapshot = await page
			.locator("body")
			.ariaSnapshot({ timeout: 5000 })
			.catch((error) => `The page could not be read: ${message(error)}`);
		// JPEG, so the picture stays small enough to read back.
		const picture =
			spec.picture &&
			(await page
				.screenshot({ path: `${spec.outDir}/check.jpg`, type: "jpeg", quality: 70 })
				.then(() => "check.jpg")
				.catch(() => undefined));
		await browser.close();
		await finish({
			status: "checked",
			picture,
			passed: failure === null,
			error: failure,
			url,
			snapshot: snapshot.slice(0, 12_000),
			console: consoleProblems,
			network: networkProblems,
		});
	}

	if (!showing) await screenshot(page, failure === null ? "At the end" : "Where the script failed").catch(() => {});

	const recording = page.video();
	await context.close();
	await rename(await recording.path(), video);
	await browser.close();

	const { size } = await stat(video);
	if (size > spec.maxBytes) {
		await rm(video);
		await skip("video_too_large");
	}
	await finish({ status: "recorded", passed: failure === null, error: failure, durationMs, bytes: size, shots });
} catch (error) {
	await skip("browser_failed", message(error));
}
