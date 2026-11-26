import { randomBytes } from "node:crypto";
import { type GitRemote, startGitRemote } from "@nullfuse/agent/testing";
import { answer, toolCalls } from "@nullfuse/agent/testing";
import { createChat, listRuns, project } from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import {
	DockerDriver,
	dockerAvailable,
	ensureRecordingImage,
	ensureSandboxImage,
	type Sandbox,
} from "@nullfuse/sandbox";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRun, type Recorder, type RunnerDeps } from "./execute";
import { SCRIPT_PATH } from "./recording";

const hasDocker = await dockerAvailable();
if (!hasDocker && process.env.CI) {
	throw new Error("Docker is required to run the recording tests in CI");
}

const db = connect();
const fixtures = new Fixtures(db);

// Leaves a file behind when it runs, to prove nothing the app writes is committed.
const app = `
const http = require("node:http");
require("node:fs").writeFileSync("app-output.log", "started");
http.createServer((request, response) => {
	response.setHeader("content-type", "text/html");
	response.end("<h1>Notes</h1>");
}).listen(4000);
`;
const script = `export default async ({ page, expect }) => {
	await page.goto("/");
	await expect(page.getByRole("heading")).toHaveText("Notes");
};`;

// Stands in for object storage: keeps what is uploaded to it.
const sink = `
const http = require("node:http");
const fs = require("node:fs");
http.createServer((request, response) => {
	if (request.url.startsWith("/refuse")) { response.statusCode = 403; return response.end(); }
	const parts = [];
	request.on("data", (part) => parts.push(part));
	request.on("end", () => {
		fs.writeFileSync("/tmp/upload.bin", Buffer.concat(parts));
		fs.writeFileSync("/tmp/upload.txt", request.method + " " + request.url);
		response.end();
	});
}).listen(8080);
`;

describe.skipIf(!hasDocker)("executeRun with a recording", () => {
	let remote: GitRemote;
	let storage: Sandbox;
	let storageUrl: string;
	let image: string;

	beforeAll(async () => {
		image = await ensureSandboxImage();
		await ensureRecordingImage();
		remote = await startGitRemote(new DockerDriver(), image);
		storage = await new DockerDriver().create({ image });
		await storage.writeFile("sink.js", sink);
		await storage.exec("nohup node sink.js >/dev/null 2>&1 &");
		const address = (await storage.exec("hostname -i")).stdout.trim();
		storageUrl = `http://${address}:8080`;
	});

	afterAll(async () => {
		await storage?.destroy();
		await remote?.sandbox.destroy();
		await fixtures.cleanup();
		await db.$client.end();
	});

	async function setup({ record = true, startCommand = "node server.js" as string | null } = {}) {
		const userId = await fixtures.user();
		const projectId = await fixtures.project(userId);
		await db
			.update(project)
			.set({ startCommand, appPort: startCommand ? 4000 : null })
			.where(eq(project.id, projectId));
		const created = await createChat(db, {
			userId,
			projectId,
			baseBranch: "main",
			model: "deepseek-v4-pro",
			content: "Add a notes page",
			record,
		});
		if (!created.ok) throw new Error(created.reason);
		return { userId, ...created };
	}

	function deps(model: MockLanguageModelV4, recorder?: Recorder): RunnerDeps {
		return {
			db,
			driver: new DockerDriver(),
			image,
			createModel: () => model,
			githubToken: async () => "unused",
			decryptEnvValue: () => randomBytes(4).toString("hex"),
			author: { name: "NullFuse Code", email: "code@example.test" },
			repoUrl: () => remote.url,
			recorder,
		};
	}

	const writesApp = (withScript = true) =>
		new MockLanguageModelV4({
			doGenerate: [
				toolCalls(
					{ name: "write", input: { path: "server.js", content: app } },
					...(withScript ? [{ name: "write", input: { path: SCRIPT_PATH, content: script } }] : []),
				),
				answer("Added the page."),
			],
		});

	const recorder = (path = "/video", linked: unknown[] = []): Recorder => ({
		image: ensureRecordingImage,
		uploadUrl: async (key) => `${storageUrl}${path}/${key}?signature=do-not-log`,
		linkPullRequest: async (input) => {
			linked.push(input);
		},
	});

	const result = async (userId: string, chatId: string) => (await listRuns(db, userId, chatId))[0];

	it("records the change, uploads it and links it on the PR, committing none of it", async () => {
		const { userId, chatId, runId } = await setup();
		const model = writesApp();
		const linked: unknown[] = [];

		await executeRun(
			{
				...deps(model, recorder("/video", linked)),
				openPullRequest: async () => ({ number: 3, url: "https://github.com/o/r/pull/3" }),
			},
			runId,
		);

		const row = await result(userId, chatId);
		expect(row).toMatchObject({ status: "succeeded", recording: { status: "recorded", passed: true } });
		if (row?.recording?.status !== "recorded") return;
		expect(row.recording.key).toContain(`${chatId}/${runId}-1.webm`);
		const stored = await storage.exec("cat /tmp/upload.txt; echo; wc -c < /tmp/upload.bin");
		expect(stored.stdout).toContain(`PUT /video/${row.recording.key}`);
		expect(Number(stored.stdout.trim().split("\n").at(-1))).toBe(row.recording.bytes);
		expect(linked).toMatchObject([{ number: 3, runId, passed: true }]);

		const first = model.doGenerateCalls[0]?.prompt[0];
		expect(first?.role === "system" && first.content).toContain(SCRIPT_PATH);
		const files = (await remote.git(`ls-tree -r --name-only nullfuse/chat-${chatId.slice(0, 8)}`)).stdout;
		expect(files).toContain("server.js");
		expect(files).not.toContain("app-output.log");
		expect(files).not.toContain("script.mjs");
	});

	it("says why when the agent writes no script, and keeps the run succeeded", async () => {
		const { userId, chatId, runId } = await setup();
		await executeRun(deps(writesApp(false), recorder()), runId);
		expect(await result(userId, chatId)).toMatchObject({
			status: "succeeded",
			recording: { status: "skipped", message: expect.stringContaining("nothing to show") },
		});
	});

	it("reports a refused upload without storing the upload link", async () => {
		const { userId, chatId, runId } = await setup();
		await executeRun(deps(writesApp(), recorder("/refuse")), runId);
		const row = await result(userId, chatId);
		expect(row?.recording).toMatchObject({ status: "skipped", message: "The video could not be uploaded." });
		expect(JSON.stringify(row?.recording)).not.toContain("do-not-log");
	});

	it("explains missing settings and storage, and records nothing unless asked", async () => {
		const answering = () => new MockLanguageModelV4({ doGenerate: async () => answer("Done.") });
		const noCommand = await setup({ startCommand: null });
		const noStorage = await setup();
		const notAsked = await setup({ record: false });

		await executeRun(deps(answering(), recorder()), noCommand.runId);
		await executeRun(deps(answering()), noStorage.runId);
		await executeRun(deps(answering(), recorder()), notAsked.runId);

		expect((await result(noCommand.userId, noCommand.chatId))?.recording).toMatchObject({
			message: expect.stringContaining("start command"),
		});
		expect((await result(noStorage.userId, noStorage.chatId))?.recording).toMatchObject({
			message: expect.stringContaining("isn't set up"),
		});
		expect((await result(notAsked.userId, notAsked.chatId))?.recording).toBeNull();
	});
});
