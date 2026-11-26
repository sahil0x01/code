import { DockerDriver, dockerAvailable, ensureRecordingImage, type Sandbox } from "@nullfuse/sandbox";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordChange } from "./recording";

const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the recording tests in CI");
}

const server = `
const http = require("node:http");
http.createServer((request, response) => {
	response.setHeader("content-type", "text/html");
	response.end('<h1>' + (process.env.GREETING || "none") + '</h1><button onclick="this.textContent=\\'clicked\\'">press</button>');
}).listen(4000);
`;

const script = (expected: string) => `
export default async ({ page, expect }) => {
	await page.goto("/");
	await expect(page.locator("h1")).toHaveText("${expected}", { timeout: 2000 });
	await page.getByRole("button").click();
	await expect(page.getByRole("button")).toHaveText("clicked");
};
`;

describe.skipIf(!hasDocker)("recordChange", () => {
	let sandbox: Sandbox;
	const app = { startCommand: "node server.js", port: 4000, env: { GREETING: "hello" } };

	beforeAll(async () => {
		// No network: recording only needs the app inside the sandbox.
		sandbox = await new DockerDriver().create({ image: await ensureRecordingImage(), network: "none" });
		await sandbox.writeFile("server.js", server);
	});
	afterAll(() => sandbox?.destroy());

	const listening = async () =>
		(await sandbox.exec("curl -s -m 2 http://localhost:4000 >/dev/null")).exitCode === 0;

	it("records a passing script as a video, and stops the app", async () => {
		const result = await recordChange(sandbox, { ...app, script: script("hello") });
		expect(result).toMatchObject({ status: "recorded", passed: true, error: null });
		if (result.status !== "recorded") return;
		expect(result.bytes).toBeGreaterThan(1000);
		// WebM files start with the EBML magic number.
		const head = await sandbox.exec(`head -c 4 ${result.path} | od -An -tx1`);
		expect(head.stdout.trim()).toBe("1a 45 df a3");
		expect(await listening()).toBe(false);
	});

	it("still records when the script's check fails, and says so", async () => {
		const result = await recordChange(sandbox, { ...app, script: script("goodbye") });
		expect(result).toMatchObject({ status: "recorded", passed: false });
		expect(result.status === "recorded" && result.error).toContain("goodbye");
	});

	it("keeps the video when the script runs too long", async () => {
		const result = await recordChange(sandbox, {
			...app,
			script: "export default async () => new Promise(() => {});",
			scriptTimeoutMs: 1500,
		});
		expect(result).toMatchObject({ status: "recorded", passed: false });
		expect(await listening()).toBe(false);
	});

	it("skips with the app's output when the start command exits", async () => {
		const result = await recordChange(sandbox, {
			...app,
			startCommand: "echo missing-database >&2; exit 1",
			script: script("hello"),
		});
		expect(result).toMatchObject({ status: "skipped", reason: "app_exited" });
		expect(result.status === "skipped" && result.detail).toContain("missing-database");
	});

	it("skips and cleans up when the app never listens", async () => {
		const result = await recordChange(sandbox, {
			...app,
			startCommand: "sleep 300",
			script: script("hello"),
			startTimeoutMs: 1500,
		});
		expect(result).toMatchObject({ status: "skipped", reason: "app_not_ready" });
		const left = await sandbox.exec(
			"for f in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < $f 2>/dev/null; echo; done | grep -c '^sleep 300' || true",
		);
		expect(left.stdout.trim()).toBe("0");
	});

	it("skips a script that cannot load, and a video over the size limit", async () => {
		expect(await recordChange(sandbox, { ...app, script: "export default (" })).toMatchObject({
			reason: "bad_script",
		});
		expect(
			await recordChange(sandbox, { ...app, script: script("hello"), maxBytes: 10 }),
		).toMatchObject({ reason: "video_too_large" });
	});

	it("reports a run that ends without a result", async () => {
		const result = await recordChange(sandbox, {
			...app,
			script: "process.exit(0); export default async () => {};",
		});
		expect(result).toMatchObject({ status: "skipped", reason: "no_result" });
	});
});
