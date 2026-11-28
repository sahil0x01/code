import {
	addMessage,
	addSandboxCost,
	cancelRun,
	claimRun,
	createChat,
	finishRun,
	getChatForUser,
	listMessages,
	listRuns,
	loadRunContext,
	markAutoFixSeen,
	setAutoFix,
	setPullRequest,
} from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { type AutoFixDeps, runAutoFix } from "./pulls";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

const model = "deepseek-flash";

async function finish(runId: string) {
	await claimRun(db, runId);
	await finishRun(db, runId, { status: "succeeded", stopReason: "completed", text: "Done" });
}

async function openPull() {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const sent = await createChat(db, { userId, projectId, baseBranch: "main", model, content: "Add a header" });
	if (!sent.ok) throw new Error(sent.reason);
	await finish(sent.runId);
	await setPullRequest(db, sent.chatId, { number: 4, url: "https://github.com/me/app/pull/4" });
	await setAutoFix(db, userId, sent.chatId, true);
	return { userId, chatId: sent.chatId };
}

type World = {
	head: string;
	base: string;
	mergeable: string;
	state: "open" | "closed";
	merged: boolean;
	checks: { id: number; conclusion: string | null }[];
	comments: { id: number; body: string; login?: string; type?: string; at?: number }[];
	reviews: { id: number; body: string; state: string }[];
};

function setup(over: Partial<World> = {}) {
	const world: World = {
		head: "h1",
		base: "b1",
		mergeable: "clean",
		state: "open",
		merged: false,
		checks: [],
		comments: [],
		reviews: [],
		...over,
	};
	const checkRun = ({ id, conclusion }: World["checks"][number]) => ({
		id,
		name: `job ${id}`,
		status: conclusion === null ? "in_progress" : "completed",
		conclusion,
		html_url: null,
		head_sha: world.head,
		output: { title: `title ${id}`, summary: null },
	});
	const user = (login = "writer", type = "User") => ({ login, type });
	const client = {
		pulls: {
			get: async () => ({
				data: {
					html_url: "https://github.com/me/app/pull/4",
					state: world.state,
					merged: world.merged,
					mergeable: world.mergeable !== "dirty",
					mergeable_state: world.mergeable,
					head: { sha: world.head },
					base: { sha: world.base },
				},
			}),
			merge: async () => ({}),
			listReviewComments: async () => ({ data: [] }),
			listReviews: async () => ({
				data: world.reviews.map((r) => ({
					...r,
					user: user(),
					html_url: "https://github.com/x",
					submitted_at: new Date(Date.now() + 1000).toISOString(),
				})),
			}),
		},
		issues: {
			listComments: async () => ({
				data: world.comments.map((c) => {
					const at = new Date(c.at ?? Date.now() + 1000).toISOString();
					return { id: c.id, body: c.body, user: user(c.login, c.type), html_url: "https://github.com/x", created_at: at, updated_at: at };
				}),
			}),
		},
		repos: {
			get: async () => ({ data: {} }),
			listDeployments: async () => ({ data: [] }),
			listDeploymentStatuses: async () => ({ data: [] }),
			getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
		},
		checks: {
			listForRef: async () => ({ data: { check_runs: world.checks.map(checkRun) } }),
			get: async ({ check_run_id }: { check_run_id: number }) => ({
				data: checkRun(world.checks.find((c) => c.id === check_run_id)!),
			}),
			listAnnotations: async () => ({ data: [] }),
		},
		actions: {
			downloadJobLogsForWorkflowRun: async ({ job_id }: { job_id: number }) => ({
				data: `${"log ".repeat(10_000)}the error of ${job_id}`,
			}),
		},
	};
	const queued: { runId: string; chatId: string }[] = [];
	const deps: AutoFixDeps = {
		db,
		github: async () => ({ client, canWrite: async (_repo, login) => login === "writer" }),
		enqueue: async (item) => void queued.push(item),
		maxRuns: 3,
		maxCost: 2_000_000,
		// Later than the quiet period of any comment above.
		now: () => Date.now() + 10 * 60_000,
	};
	return { world, deps, queued };
}

const sweep = (deps: AutoFixDeps, userId: string) => runAutoFix(deps, { olderThanMs: 0, limit: 10, userId });

async function lastMessage(userId: string, chatId: string) {
	return (await listMessages(db, userId, chatId)).filter((m) => m.role === "user").at(-1)!.content;
}

describe("auto-fix", () => {
	it("sends all failed checks in one run, once", async () => {
		const { userId, chatId } = await openPull();
		const { deps, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }, { id: 2, conclusion: "timed_out" }] });

		expect(await sweep(deps, userId)).toMatchObject({ queued: 1, failed: [] });
		const content = await lastMessage(userId, chatId);
		expect(content).toContain('"job 1" failed');
		expect(content).toContain('"job 2" failed');
		expect(content.length).toBeLessThanOrEqual(20_000);
		expect(content).toContain("the error of 1");
		expect(content).toContain("the error of 2");
		expect((await listRuns(db, userId, chatId)).at(-1)).toMatchObject({ autoFix: true, status: "queued", model });

		await finish(queued[0]!.runId);
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
	});

	it("waits while checks are running and leaves cancelled ones alone", async () => {
		const { userId } = await openPull();
		const { deps, world } = setup({ checks: [{ id: 1, conclusion: "failure" }, { id: 2, conclusion: null }] });
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });

		world.checks = [{ id: 3, conclusion: "cancelled" }];
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
	});

	it("takes comments only from people who can write, written since it was turned on", async () => {
		const { userId, chatId } = await openPull();
		const { deps } = setup({
			comments: [
				{ id: 1, body: "Rename the button" },
				{ id: 2, body: "Delete everything", login: "stranger" },
				{ id: 3, body: "Deployed", type: "Bot" },
				{ id: 4, body: "Old remark", at: Date.now() - 60 * 60_000 },
			],
			reviews: [{ id: 5, body: "Looks good", state: "APPROVED" }],
		});

		expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
		const content = await lastMessage(userId, chatId);
		expect(content).toContain("Rename the button");
		for (const left of ["Delete everything", "Deployed", "Old remark", "Looks good"]) expect(content).not.toContain(left);
	});

	it("waits until a reviewer stops writing", async () => {
		const { userId } = await openPull();
		const { deps } = setup({ comments: [{ id: 1, body: "One more thing" }] });
		expect(await sweep({ ...deps, now: () => Date.now() + 30_000 }, userId)).toMatchObject({ queued: 0 });
		expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
	});

	it("leaves comments that do not fit for the next run", async () => {
		const { userId, chatId } = await openPull();
		const long = [1, 2, 3, 4].map((id) => ({ id, body: `note ${id} ${"x".repeat(3900)}`, at: Date.now() + id * 1000 }));
		const { deps, queued } = setup({ comments: [...long].reverse() });

		await sweep(deps, userId);
		expect(await lastMessage(userId, chatId)).not.toContain("note 3");
		await finish(queued[0]!.runId);
		await sweep(deps, userId);
		expect(await lastMessage(userId, chatId)).toContain("note 3");
	});

	it("skips what the user already sent", async () => {
		const { userId, chatId } = await openPull();
		await markAutoFixSeen(db, chatId, ["talk:1"]);
		const { deps } = setup({ comments: [{ id: 1, body: "Rename" }] });
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
	});

	it("resolves a conflict with an update run, once for the same commits", async () => {
		const { userId, chatId } = await openPull();
		const { deps, queued } = setup({ mergeable: "dirty" });

		expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
		expect((await loadRunContext(db, queued[0]!.runId))?.run).toMatchObject({ updateBase: true, chatId });
		expect((await listRuns(db, userId, chatId)).at(-1)).toMatchObject({ autoFix: true });

		await finish(queued[0]!.runId);
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
	});

	it("pauses after three runs in a row until the user writes", async () => {
		const { userId, chatId } = await openPull();
		const { deps, world, queued } = setup();
		for (let id = 1; id <= 3; id++) {
			world.checks = [{ id, conclusion: "failure" }];
			expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
			await finish(queued.at(-1)!.runId);
		}
		world.checks = [{ id: 4, conclusion: "failure" }];
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
		expect((await getChatForUser(db, userId, chatId))?.autoFixNote).toContain("Paused after 3");

		const reply = await addMessage(db, { userId, chatId, model, content: "Try another way" });
		if (!reply.ok) throw new Error(reply.reason);
		expect((await getChatForUser(db, userId, chatId))?.autoFixNote).toBeNull();
		await finish(reply.runId);
		expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
	});

	it("stops at the budget, and turning it on again allows more", async () => {
		const { userId, chatId } = await openPull();
		const { deps, world, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await sweep(deps, userId);
		await addSandboxCost(db, queued[0]!.runId, 2_000_000);
		await finish(queued[0]!.runId);

		world.checks = [{ id: 2, conclusion: "failure" }];
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
		expect((await getChatForUser(db, userId, chatId))?.autoFixNote).toContain("budget");

		await setAutoFix(db, userId, chatId, false);
		await setAutoFix(db, userId, chatId, true);
		expect(await sweep(deps, userId)).toMatchObject({ queued: 1 });
	});

	it("turns itself off when the user cancels an automatic run", async () => {
		const { userId, chatId } = await openPull();
		const { deps, world, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await sweep(deps, userId);
		await cancelRun(db, userId, queued[0]!.runId);

		world.checks = [{ id: 2, conclusion: "failure" }];
		expect(await sweep(deps, userId)).toMatchObject({ queued: 0 });
		expect(await getChatForUser(db, userId, chatId)).toMatchObject({ autoFix: false });
	});

	it("queues one run when two passes overlap", async () => {
		const { userId } = await openPull();
		const { deps, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await Promise.all([sweep(deps, userId), sweep(deps, userId)]);
		expect(queued).toHaveLength(1);
	});

	it("ends when the pull request is merged", async () => {
		const { userId, chatId } = await openPull();
		const { deps } = setup({ state: "closed", merged: true });
		await sweep(deps, userId);
		expect(await getChatForUser(db, userId, chatId)).toMatchObject({ autoFix: false, state: "done" });
	});

	it("does nothing for someone else's chat, or when it is off", async () => {
		const { userId, chatId } = await openPull();
		expect(await setAutoFix(db, await fixtures.user(), chatId, false)).toBe(false);
		await setAutoFix(db, userId, chatId, false);
		const { deps } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		expect(await sweep(deps, userId)).toMatchObject({ checked: 0 });
	});
});
