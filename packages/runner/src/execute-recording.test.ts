import { randomBytes } from "node:crypto";
import { type GitRemote, startGitRemote } from "@nullfuse/agent/testing";
import { answer, toolCalls } from "@nullfuse/agent/testing";
import { createChat, listRuns, listRunSteps, project, recordingDeletion, user } from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import {
	DockerDriver,
	dockerAvailable,
	ensureRecordingImage,
	ensureSandboxImage,
	type Sandbox,
} from "@nullfuse/sandbox";
import { MockLanguageModelV4 } from "ai/test";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executeRun, type Recorder, type RunnerDeps } from "./execute";
import { COMMANDS_PATH, proofPage } from "./proof";
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

	async function setup({ startCommand = "node server.js" as string | null, message = "Add a notes page" } = {}) {
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
			content: message,
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
			author: { name: "Prefill Code", email: "code@example.test" },
			repoUrl: () => remote.url,
			browserImage: ensureRecordingImage,
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
		expect(row.recording).toMatchObject({ kind: "web", screenshots: [{ label: "At the end" }] });
		// The screenshot is sent after the video, so it is what the stand-in kept last.
		const stored = await storage.exec("cat /tmp/upload.txt");
		expect(stored.stdout).toContain(`PUT /video/${row.recording.screenshots?.[0]?.key}`);
		expect(linked).toMatchObject([{ number: 3, runId, passed: true }]);

		const first = model.doGenerateCalls[0]?.prompt[0];
		expect(first?.role === "system" && first.content).toContain(SCRIPT_PATH);
		const files = (await remote.git(`ls-tree -r --name-only nullfuse/chat-${chatId.slice(0, 8)}`)).stdout;
		expect(files).toContain("server.js");
		expect(files).not.toContain("app-output.log");
		expect(files).not.toContain("script.mjs");
	});

	it("queues the video for deletion when the account goes away during the upload", async () => {
		const { userId, runId } = await setup();
		const base = recorder();
		await executeRun(
			deps(writesApp(), {
				...base,
				uploadUrl: async (key) => {
					await db.delete(user).where(eq(user.id, userId));
					return base.uploadUrl(key);
				},
			}),
			runId,
		);

		const queued = await db
			.select()
			.from(recordingDeletion)
			.where(like(recordingDeletion.key, `%/${runId}-1.webm`));
		expect(queued).toHaveLength(1);
	});

	it("lets the agent check the app in a browser, with the repository's rules in its prompt", async () => {
		const { userId, chatId, runId } = await setup();
		const broken = app.replace("<h1>Notes</h1>", "<h1>Notes</h1><script>console.error('boom-in-page')</script><img src=/missing.png>");
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: "server.js", content: broken } }),
				toolCalls({ name: "check_app", input: {} }),
				toolCalls({
					name: "check_app",
					input: {
						script: "export default async ({ page, expect }) => { await page.goto('/'); await expect(page.getByRole('heading')).toHaveText('Other', { timeout: 1000 }); };",
					},
				}),
				answer("Checked."),
			],
		});

		await executeRun(deps(model), runId);

		const outputs = (await listRunSteps(db, userId, runId)).flatMap((step) => step.toolResults);
		const [, first, second] = outputs;
		expect(first?.isError).toBeFalsy();
		expect(first?.output).toContain('heading "Notes"');
		expect(first?.output).toContain("boom-in-page");
		expect(second?.output).toContain("The script failed");
		expect(second?.output).toContain("Other");
		const prompt = model.doGenerateCalls[0]?.prompt[0];
		expect(prompt?.role === "system" && prompt.content).toContain("verify it with the check_app tool");
		expect((await result(userId, chatId))?.status).toBe("succeeded");
	});

	it("tells the agent why the app could not be checked", async () => {
		const { userId, runId } = await setup({ startCommand: "echo no-database >&2; exit 1" });
		const model = new MockLanguageModelV4({
			doGenerate: [toolCalls({ name: "check_app", input: {} }), answer("It does not start.")],
		});

		await executeRun(deps(model), runId);

		const [step] = await listRunSteps(db, userId, runId);
		expect(step?.toolResults[0]).toMatchObject({ isError: true, output: expect.stringContaining("no-database") });
	});

	it("records a page of the work when there is no script, with commands run again", async () => {
		const { userId, chatId, runId } = await setup({ startCommand: null });
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls(
					{ name: "write", input: { path: "sum.js", content: "console.log('total', 2 + 3)\n" } },
					{ name: "write", input: { path: COMMANDS_PATH, content: '["node sum.js"]' } },
				),
				answer("Added sum.js."),
			],
		});

		await executeRun(deps(model, recorder()), runId);

		const row = await result(userId, chatId);
		expect(row).toMatchObject({ status: "succeeded", recording: { status: "recorded", kind: "page", passed: true } });
		if (row?.recording?.status !== "recorded") return;
		expect(row.recording.screenshots).toEqual([
			{ key: row.recording.key.replace(".webm", "-1.png"), label: "The whole record" },
		]);
		const first = model.doGenerateCalls[0]?.prompt[0];
		expect(first?.role === "system" && first.content).toContain(COMMANDS_PATH);
		const files = (await remote.git(`ls-tree -r --name-only nullfuse/chat-${chatId.slice(0, 8)}`)).stdout;
		expect(files).not.toContain("commands.json");
	});

	it("shows a command that fails when run again", async () => {
		const { userId, chatId, runId } = await setup({ startCommand: null });
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: COMMANDS_PATH, content: '["exit 3"]' } }),
				answer("It works."),
			],
		});

		await executeRun(deps(model, recorder()), runId);

		expect((await result(userId, chatId))?.recording).toMatchObject({ status: "recorded", passed: false });
	});

	it("records nothing for an answer, documentation or a read-only turn", async () => {
		const answering = await setup({ startCommand: null });
		await executeRun(deps(new MockLanguageModelV4({ doGenerate: async () => answer("It adds notes.") }), recorder()), answering.runId);
		expect((await result(answering.userId, answering.chatId))?.recording).toBeNull();

		const documenting = await setup({ startCommand: null });
		const docs = new MockLanguageModelV4({
			doGenerate: [toolCalls({ name: "write", input: { path: "NOTES.md", content: "# Notes\n" } }), answer("Documented.")],
		});
		await executeRun(deps(docs, recorder()), documenting.runId);
		expect((await result(documenting.userId, documenting.chatId))?.recording).toBeNull();

		const asking = await setup({ message: "/ask what is here?" });
		const model = new MockLanguageModelV4({ doGenerate: async () => answer("A page.") });
		await executeRun(deps(model, recorder()), asking.runId);
		expect((await result(asking.userId, asking.chatId))?.recording).toBeNull();
		const prompt = model.doGenerateCalls[0]?.prompt[0];
		expect(prompt?.role === "system" && prompt.content).not.toContain(COMMANDS_PATH);
	});

	it("records logs the agent asks to show, even when no file changed", async () => {
		const { userId, chatId, runId } = await setup({ startCommand: null });
		const model = new MockLanguageModelV4({
			doGenerate: [
				toolCalls({ name: "write", input: { path: COMMANDS_PATH, content: '["echo the-log-line"]' } }),
				answer("This is the log."),
			],
		});
		await executeRun(deps(model, recorder()), runId);
		expect((await result(userId, chatId))?.recording).toMatchObject({ status: "recorded", kind: "page" });
	});

	it("records changed code even when the agent asks for nothing, and when the app cannot start", async () => {
		const silent = await setup({ startCommand: null });
		await executeRun(deps(writesApp(false), recorder()), silent.runId);
		expect((await result(silent.userId, silent.chatId))?.recording).toMatchObject({ status: "recorded", kind: "page" });

		const broken = await setup({ startCommand: "exit 1" });
		await executeRun(deps(writesApp(), recorder()), broken.runId);
		expect((await result(broken.userId, broken.chatId))?.recording).toMatchObject({ status: "recorded", kind: "page" });
	});

	it("reports a refused upload without storing the upload link", async () => {
		const { userId, chatId, runId } = await setup();
		await executeRun(deps(writesApp(), recorder("/refuse")), runId);
		const row = await result(userId, chatId);
		expect(row?.recording).toMatchObject({ status: "skipped", message: "The video could not be uploaded." });
		expect(JSON.stringify(row?.recording)).not.toContain("do-not-log");
	});

	it("says when proof of changed code cannot be kept", async () => {
		const noStorage = await setup();
		await executeRun(deps(writesApp()), noStorage.runId);
		expect((await result(noStorage.userId, noStorage.chatId))?.recording).toMatchObject({
			message: expect.stringContaining("isn't set up"),
		});
	});
});

describe("proofPage", () => {
	it("escapes everything, and hides secrets before escaping changes them", () => {
		const html = proofPage(
			[{ heading: "Out", blocks: [{ title: "<img src=x>", text: "<script>alert(1)</script> pa<ss&word" }] }],
			(text) => text.replaceAll("pa<ss&word", "[hidden]"),
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img");
		expect(html).toContain("[hidden]");
		expect(html).not.toContain("ss&amp;word");
	});
});
