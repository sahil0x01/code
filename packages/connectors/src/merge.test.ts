import {
	addMessage,
	cancelMerge,
	cancelRun,
	claimRun,
	createChat,
	finishRun,
	getChatForUser,
	listMessages,
	listRuns,
	loadRunContext,
	requestMerge,
	setPullRequest,
} from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import { afterAll, describe, expect, it } from "vitest";
import { type MergeDeps, runMerges, stepMerge } from "./pulls";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

const model = "deepseek-flash";
const SHA = "approved";

async function finish(runId: string, status: "succeeded" | "failed" = "succeeded") {
	await claimRun(db, runId);
	await finishRun(db, runId, { status, stopReason: status === "failed" ? "error" : "completed", text: "Done" });
}

async function openPull(options: { request?: boolean } = {}) {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const sent = await createChat(db, { userId, projectId, baseBranch: "main", model, content: "Add a header" });
	if (!sent.ok) throw new Error(sent.reason);
	await finish(sent.runId);
	await setPullRequest(db, sent.chatId, { number: 4, url: "https://github.com/me/app/pull/4" });
	if (options.request !== false) await requestMerge(db, userId, sent.chatId, SHA);
	return { userId, chatId: sent.chatId };
}

type World = {
	head: string;
	mergeable: string;
	state: "open" | "closed";
	merged: boolean;
	draft: boolean;
	checks: { id: number; conclusion: string | null }[];
	/** The commits each commit was made from. */
	parents: Record<string, string[]>;
	/** Commits the base branch contains. */
	onBase: string[];
};

function setup(over: Partial<World> = {}) {
	const world: World = {
		head: SHA,
		mergeable: "clean",
		state: "open",
		merged: false,
		draft: false,
		checks: [{ id: 1, conclusion: "success" }],
		parents: {},
		onBase: [],
		...over,
	};
	const merges: string[] = [];
	const updates: string[] = [];
	const checkRun = ({ id, conclusion }: World["checks"][number]) => ({
		id,
		name: `job ${id}`,
		status: conclusion === null ? "in_progress" : "completed",
		conclusion,
		html_url: null,
		head_sha: world.head,
		output: { title: `title ${id}`, summary: null },
	});
	const client = {
		pulls: {
			get: async () => ({
				data: {
					html_url: "https://github.com/me/app/pull/4",
					state: world.state,
					merged: world.merged,
					draft: world.draft,
					mergeable: world.mergeable !== "dirty",
					mergeable_state: world.mergeable,
					head: { sha: world.head },
					base: { sha: "base" },
				},
			}),
			merge: async ({ sha }: { sha: string }) => {
				merges.push(sha);
				world.merged = true;
				world.state = "closed";
				return {};
			},
			updateBranch: async ({ expected_head_sha }: { expected_head_sha: string }) => {
				updates.push(expected_head_sha);
				return {};
			},
		},
		repos: {
			get: async () => ({ data: {} }),
			listDeployments: async () => ({ data: [] }),
			listDeploymentStatuses: async () => ({ data: [] }),
			getCombinedStatusForRef: async () => ({ data: { statuses: [] } }),
			getCommit: async ({ ref }: { ref: string }) => ({
				data: { parents: (world.parents[ref] ?? []).map((sha) => ({ sha })) },
			}),
			compareCommitsWithBasehead: async ({ basehead }: { basehead: string }) => ({
				data: { status: world.onBase.includes(basehead.split("...")[0]!) ? "ahead" : "diverged" },
			}),
		},
		checks: {
			listForRef: async () => ({ data: { check_runs: world.checks.map(checkRun) } }),
			get: async ({ check_run_id }: { check_run_id: number }) => ({
				data: checkRun(world.checks.find((c) => c.id === check_run_id)!),
			}),
			listAnnotations: async () => ({
				data: [
					{ path: ".github", start_line: 2, message: "an old runtime", annotation_level: "warning" },
					{ path: "a.ts", start_line: 3, message: "boom", annotation_level: "failure" },
				],
			}),
		},
		actions: {
			downloadJobLogsForWorkflowRun: async ({ job_id }: { job_id: number }) => ({
				data: `${"log ".repeat(10_000)}the error of ${job_id}`,
			}),
		},
	};
	const queued: { runId: string; chatId: string }[] = [];
	let later = 0;
	const deps: MergeDeps = {
		db,
		github: async () => client,
		enqueue: async (item) => void queued.push(item),
		now: () => Date.now() + later,
	};
	const wait = (minutes: number) => (later += minutes * 60_000);
	return { world, deps, queued, merges, updates, wait };
}

const chatOf = async (userId: string, chatId: string) => (await getChatForUser(db, userId, chatId))!;

describe("merging", () => {
	it("merges the approved commit when everything passes", async () => {
		const { userId, chatId } = await openPull();
		const { deps, merges } = setup();

		expect(await stepMerge(deps, chatId)).toBe("merged");
		expect(merges).toEqual([SHA]);
		expect(await chatOf(userId, chatId)).toMatchObject({ merging: false, mergeNote: null, state: "done" });
	});

	it("takes no more messages once merged", async () => {
		const { userId, chatId } = await openPull();
		await stepMerge(setup().deps, chatId);

		expect(await addMessage(db, { userId, chatId, model, content: "One more thing" })).toEqual({
			ok: false,
			reason: "merged",
		});
		expect(await chatOf(userId, chatId)).toMatchObject({ merged: true });
	});

	it("waits for running checks, then merges", async () => {
		const { chatId } = await openPull();
		const { deps, world, merges } = setup({ checks: [{ id: 1, conclusion: null }] });

		expect(await stepMerge(deps, chatId)).toBe("waiting");
		world.checks = [{ id: 1, conclusion: "success" }];
		expect(await stepMerge(deps, chatId)).toBe("merged");
		expect(merges).toEqual([SHA]);
	});

	it("fixes failed checks and asks again instead of merging the agent's changes", async () => {
		const { userId, chatId } = await openPull();
		const { deps, world, queued, merges } = setup({
			checks: [{ id: 1, conclusion: "failure" }, { id: 2, conclusion: "timed_out" }],
		});

		expect(await stepMerge(deps, chatId)).toBe("fixing");
		const content = (await listMessages(db, userId, chatId)).filter((m) => m.role === "user").at(-1)!.content;
		expect(content).toContain("the error of 1");
		expect(content).toContain("the error of 2");
		expect(content).toContain("a.ts:3 boom");
		expect(content).not.toContain("an old runtime");
		expect(content).toContain(".github/workflows");
		expect(content.length).toBeLessThanOrEqual(20_000);
		// Nothing happens while the run works.
		expect(await stepMerge(deps, chatId)).toBe("idle");

		await finish(queued[0]!.runId);
		world.head = "fixed";
		world.checks = [{ id: 3, conclusion: "success" }];
		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect(merges).toEqual([]);
		const chat = await chatOf(userId, chatId);
		expect(chat).toMatchObject({ merging: false, unread: true });
		expect(chat.mergeNote).toContain("Review them, then merge again");
	});

	it("resolves a conflict with an update run", async () => {
		const { userId, chatId } = await openPull();
		const { deps, queued } = setup({ mergeable: "dirty" });

		expect(await stepMerge(deps, chatId)).toBe("fixing");
		expect((await loadRunContext(db, queued[0]!.runId))?.run).toMatchObject({ updateBase: true });
		expect((await listRuns(db, userId, chatId)).at(-1)).toMatchObject({ model, status: "queued" });
	});

	it("gives up after two fix runs", async () => {
		const { userId, chatId } = await openPull();
		const { deps, world, queued, wait } = setup({ checks: [{ id: 1, conclusion: "failure" }] });

		for (let attempt = 1; attempt <= 2; attempt++) {
			expect(await stepMerge(deps, chatId)).toBe("fixing");
			await finish(queued.at(-1)!.runId);
			world.head = `fix-${attempt}`;
			wait(3);
		}
		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect(queued).toHaveLength(2);
		expect((await chatOf(userId, chatId)).mergeNote).toContain("after 2 fix runs");
	});

	it("gives GitHub time to show the fix, then says nothing changed", async () => {
		const { userId, chatId } = await openPull();
		const { deps, queued, wait } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await stepMerge(deps, chatId);
		await finish(queued[0]!.runId);

		expect(await stepMerge(deps, chatId)).toBe("waiting");
		wait(3);
		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect((await chatOf(userId, chatId)).mergeNote).toContain("made no change");
	});

	it("does not take a fix without checks yet as passing", async () => {
		const { chatId } = await openPull();
		const { deps, world, queued, wait } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await stepMerge(deps, chatId);
		await finish(queued[0]!.runId);
		world.head = "fixed";
		world.checks = [];

		expect(await stepMerge(deps, chatId)).toBe("waiting");
		wait(3);
		expect(await stepMerge(deps, chatId)).toBe("stopped");
	});

	it.each(["failed", "cancelled"] as const)("stops when the fix run is %s", async (how) => {
		const { userId, chatId } = await openPull();
		const { deps, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await stepMerge(deps, chatId);
		if (how === "failed") await finish(queued[0]!.runId, "failed");
		else await cancelRun(db, userId, queued[0]!.runId);

		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect((await chatOf(userId, chatId)).mergeNote).toContain("did not finish");
	});

	it("does not send a failure only a person can deal with", async () => {
		const { chatId } = await openPull();
		const { deps, queued } = setup({ checks: [{ id: 1, conclusion: "cancelled" }] });

		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect(queued).toEqual([]);
	});

	it("updates a branch that is behind, then merges the update", async () => {
		const { chatId } = await openPull();
		const { deps, world, updates, merges } = setup({ mergeable: "behind" });

		expect(await stepMerge(deps, chatId)).toBe("updating");
		expect(await stepMerge(deps, chatId)).toBe("waiting");
		expect(updates).toEqual([SHA]);

		Object.assign(world, { head: "updated", mergeable: "clean", parents: { updated: [SHA, "newbase"] }, onBase: ["newbase"] });
		expect(await stepMerge(deps, chatId)).toBe("merged");
		expect(merges).toEqual(["updated"]);
	});

	it("does not merge an update that brought in more than the base", async () => {
		const { chatId } = await openPull();
		const { deps, world, merges } = setup({ mergeable: "behind" });
		await stepMerge(deps, chatId);
		Object.assign(world, { head: "other", mergeable: "clean", parents: { other: [SHA, "elsewhere"] } });

		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect(merges).toEqual([]);
	});

	it("stops when someone else changes the branch", async () => {
		const { userId, chatId } = await openPull();
		const { deps, merges } = setup({ head: "pushed" });

		expect(await stepMerge(deps, chatId)).toBe("stopped");
		expect(merges).toEqual([]);
		expect((await chatOf(userId, chatId)).mergeNote).toContain("branch changed");
	});

	it("stops after two hours", async () => {
		const { chatId } = await openPull();
		const { deps, wait } = setup({ checks: [{ id: 1, conclusion: null }] });
		wait(121);
		expect(await stepMerge(deps, chatId)).toBe("stopped");
	});

	it("is called off by a new message or by Cancel", async () => {
		const first = await openPull();
		const sent = await addMessage(db, { ...first, model, content: "Change the colour" });
		if (!sent.ok) throw new Error(sent.reason);
		await finish(sent.runId);
		const second = await openPull();
		await cancelMerge(db, second.userId, second.chatId);
		const { deps, merges } = setup();

		expect(await stepMerge(deps, first.chatId)).toBe("idle");
		expect(await stepMerge(deps, second.chatId)).toBe("idle");
		expect(merges).toEqual([]);
	});

	it("cannot be started on someone else's chat or while a run is working", async () => {
		const { userId, chatId } = await openPull({ request: false });
		expect(await requestMerge(db, await fixtures.user(), chatId, SHA)).toBe(false);
		await addMessage(db, { userId, chatId, model, content: "More" });
		expect(await requestMerge(db, userId, chatId, SHA)).toBe(false);
	});

	it("queues one fix when two callers step at once", async () => {
		const { chatId } = await openPull();
		const { deps, queued } = setup({ checks: [{ id: 1, conclusion: "failure" }] });
		await Promise.all([stepMerge(deps, chatId), stepMerge(deps, chatId)]);
		expect(queued).toHaveLength(1);
	});

	it("is finished by a pass when no page is open", async () => {
		const { userId } = await openPull();
		const { deps, merges } = setup();
		expect(await runMerges(deps, { olderThanMs: 0, limit: 10, userId })).toEqual({ checked: 1, failed: [] });
		expect(merges).toEqual([SHA]);
	});
});
