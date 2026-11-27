import { randomUUID } from "node:crypto";
import {
	claimReports,
	claimRun,
	createLinkCode,
	findChatByPullRequest,
	exportAccountData,
	finishRun,
	listConnections,
	MAX_REPORT_ATTEMPTS,
	type PendingReport,
	redeemLinkCode,
	saveConnection,
	setConnectionProject,
	setPullRequest,
} from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { sendReports } from "./report";
import { startConnectorTask, type TaskDeps, type TaskInput } from "./task";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

async function linked(options: { projects?: number } = {}) {
	const userId = await fixtures.user();
	const projects: string[] = [];
	for (let i = 0; i < (options.projects ?? 1); i++) projects.push(await fixtures.project(userId));
	const identity = { provider: "slack" as const, workspaceId: `T${randomUUID()}`, externalUserId: "U1" };
	await saveConnection(db, { ...identity, userId, workspaceName: "Acme", tokenEncrypted: "sealed" });
	return { userId, projects, identity };
}

function task(identity: Awaited<ReturnType<typeof linked>>["identity"], over: Partial<TaskInput> = {}): TaskInput {
	return {
		...identity,
		externalId: randomUUID(),
		content: "Fix the header",
		model: "deepseek-flash",
		reasoning: "high",
		planOnly: false,
		verify: false,
		...over,
	};
}

function deps(over: Partial<TaskDeps> = {}) {
	const queued: { runId: string; chatId: string }[] = [];
	const value: TaskDeps = {
		db,
		canRead: async () => true,
		enqueue: async (run) => void queued.push(run),
		...over,
	};
	return { value, queued };
}

describe("startConnectorTask", () => {
	it("starts a chat in the linked project", async () => {
		const { identity } = await linked();
		const { value, queued } = deps();

		const result = await startConnectorTask(value, task(identity));

		expect(result).toMatchObject({ ok: true });
		expect(queued).toHaveLength(1);
	});

	it("refuses someone who is not linked", async () => {
		const { identity } = await linked();
		const { value, queued } = deps();

		const result = await startConnectorTask(value, task(identity, { externalUserId: "U2" }));

		expect(result).toEqual({ ok: false, reason: "not_linked" });
		expect(queued).toHaveLength(0);
	});

	it("starts one run when the same request arrives twice", async () => {
		const { identity } = await linked();
		const { value, queued } = deps();
		const input = task(identity);

		await startConnectorTask(value, input);
		const second = await startConnectorTask(value, input);

		expect(second).toEqual({ ok: false, reason: "duplicate" });
		expect(queued).toHaveLength(1);
	});

	it("asks for a project when there are several, and takes only the user's own", async () => {
		const { userId, projects, identity } = await linked({ projects: 2 });
		const other = await linked();
		const [link] = await listConnections(db, userId);
		if (!link) throw new Error("no connection");

		await expect(startConnectorTask(deps().value, task(identity))).resolves.toEqual({
			ok: false,
			reason: "no_project",
		});
		await expect(setConnectionProject(db, userId, link.id, other.projects[0] as string)).resolves.toBe(false);
		await expect(setConnectionProject(db, other.userId, link.id, other.projects[0] as string)).resolves.toBe(false);
		await expect(setConnectionProject(db, userId, link.id, projects[1] as string)).resolves.toBe(true);
	});

	it("starts nothing when the repository cannot be read", async () => {
		const { identity } = await linked();
		const { value, queued } = deps({ canRead: async () => false });

		await expect(startConnectorTask(value, task(identity))).resolves.toEqual({ ok: false, reason: "unreadable" });
		expect(queued).toHaveLength(0);
	});

	it("moves a link to whoever proved the account last", async () => {
		const first = await linked();
		const userId = await fixtures.user();
		await saveConnection(db, { ...first.identity, userId, workspaceName: "Acme", tokenEncrypted: "sealed" });

		expect(await listConnections(db, first.userId)).toEqual([]);
		expect(await listConnections(db, userId)).toHaveLength(1);
	});

	it("leaves the token out of the account export", async () => {
		const { userId } = await linked();
		const data = await exportAccountData(db, userId);

		expect(data?.connections).toHaveLength(1);
		expect(JSON.stringify(data)).not.toContain("sealed");
	});
});

async function finished(status: "succeeded" | "failed" = "succeeded") {
	const link = await linked();
	const { value, queued } = deps();
	await startConnectorTask(value, task(link.identity));
	const [run] = queued;
	if (!run) throw new Error("no run");
	await claimRun(db, run.runId);
	await setPullRequest(db, run.chatId, { number: 7, url: "https://github.com/acme/app/pull/7" });
	await finishRun(db, run.runId, {
		status,
		stopReason: status === "failed" ? "error" : "completed",
		error: status === "failed" ? "The tests <broke>" : undefined,
		text: "Changed the header <!channel>",
	});
	return { ...link, ...run };
}

function reporter(fail = false) {
	const sent: { to: string; text: string }[] = [];
	const value = {
		db,
		appUrl: "https://app.test",
		senders: {
			slack: async (report: PendingReport, text: string) => {
				if (fail) throw new Error("channel_not_found");
				sent.push({ to: report.target ?? report.externalUserId, text });
			},
		},
	};
	return { value, sent };
}

describe("sendReports", () => {
	it("sends the result and the pull request to the person, once", async () => {
		const { runId, chatId } = await finished();
		const { value, sent } = reporter();

		await sendReports(value, { runId });
		await sendReports(value, { runId });

		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("U1");
		expect(sent[0]?.text).toContain("*Done:* Fix the header");
		expect(sent[0]?.text).toContain("https://github.com/acme/app/pull/7");
		expect(sent[0]?.text).toContain(`https://app.test/dashboard/chats/${chatId}`);
		expect(sent[0]?.text).toContain("&lt;!channel&gt;");
	});

	it("says why a run failed", async () => {
		const { runId } = await finished("failed");
		const { value, sent } = reporter();

		await sendReports(value, { runId });

		expect(sent[0]?.text).toContain("The tests &lt;broke&gt;");
	});

	it("says nothing while the run is unfinished", async () => {
		const { identity } = await linked();
		const { value, queued } = deps();
		await startConnectorTask(value, task(identity));

		await expect(claimReports(db, { runId: queued[0]?.runId })).resolves.toEqual([]);
	});

	it("tries again after a failure and gives up in the end", async () => {
		const { runId } = await finished();
		const broken = reporter(true);

		for (let i = 0; i < MAX_REPORT_ATTEMPTS; i++) {
			await expect(sendReports(broken.value, { runId })).resolves.toMatchObject({ failed: ["channel_not_found"] });
		}
		await expect(sendReports(reporter().value, { runId })).resolves.toEqual({ sent: 0, failed: [] });
	});

	it("is not sent twice by two callers at once", async () => {
		const { runId } = await finished();
		const { value, sent } = reporter();

		await Promise.all([sendReports(value, { runId }), sendReports(value, { runId })]);

		expect(sent).toHaveLength(1);
	});
});

describe("continuing a chat", () => {
	it("adds to the chat that owns the pull request and replies to the target", async () => {
		const { userId, projects, identity, chatId } = await finished();
		await sendReports(reporter().value);
		await expect(findChatByPullRequest(db, userId, projects[0] as string, 7)).resolves.toBe(chatId);
		const { value, queued } = deps();

		const result = await startConnectorTask(value, task(identity, { chatId, target: "7" }));

		expect(result).toMatchObject({ ok: true, chatId });
		await claimRun(db, queued[0]?.runId as string);
		await finishRun(db, queued[0]?.runId as string, { status: "succeeded", stopReason: "completed" });
		const { value: replies, sent } = reporter();
		await sendReports(replies, { runId: queued[0]?.runId });
		expect(sent[0]?.to).toBe("7");
	});

	it("cannot add to another person's chat", async () => {
		const theirs = await finished();
		const mine = await linked();

		await expect(
			startConnectorTask(deps().value, task(mine.identity, { chatId: theirs.chatId })),
		).resolves.toEqual({ ok: false, reason: "not_found" });
	});
});

describe("link codes", () => {
	it("work once, for the tool they were made for", async () => {
		const userId = await fixtures.user();
		const code = await createLinkCode(db, userId, "telegram");

		await expect(redeemLinkCode(db, "slack", code)).resolves.toBeNull();
		await expect(redeemLinkCode(db, "telegram", code)).resolves.toEqual({ userId, name: "Test User" });
		await expect(redeemLinkCode(db, "telegram", code)).resolves.toBeNull();
	});

	it("stop working when a newer one is made or they expire", async () => {
		const userId = await fixtures.user();
		const old = await createLinkCode(db, userId, "telegram");
		const fresh = await createLinkCode(db, userId, "telegram");
		await expect(redeemLinkCode(db, "telegram", old)).resolves.toBeNull();
		await db.$client.query("update connector_link_code set expires_at = now() - interval '1 second' where user_id = $1", [userId]);
		await expect(redeemLinkCode(db, "telegram", fresh)).resolves.toBeNull();
	});
});
