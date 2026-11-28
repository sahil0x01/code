import { describe, expect, it, vi } from "vitest";
import { summarizeChecks } from "@nullfuse/connectors/pulls/status";
import { handlePull, type PullDeps } from "./pr-handler";
import { failureReport, loadPull, mergePull, type PullClient } from "@nullfuse/connectors/pulls";

const SHA = "b".repeat(40);
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

const checkRun = (id: number, conclusion: string | null, head = SHA) => ({
	id,
	name: `job ${id}`,
	status: conclusion === null ? "in_progress" : "completed",
	conclusion,
	html_url: "https://github.com/x",
	head_sha: head,
	output: { title: "Tests failed", summary: null },
});

function client(pull: Partial<Awaited<ReturnType<PullClient["pulls"]["get"]>>["data"]> = {}) {
	const data = {
		html_url: "https://github.com/me/app/pull/4",
		state: "open",
		merged: false,
		draft: false,
		mergeable: true as boolean | null,
		mergeable_state: "clean",
		head: { sha: SHA },
		base: { sha: "a".repeat(40) },
		...pull,
	};
	return {
		pulls: {
			get: vi.fn(async () => ({ data })),
			merge: vi.fn(async () => ({})),
		},
		repos: {
			get: vi.fn(async () => ({
				data: { allow_squash_merge: true, allow_merge_commit: true },
			})),
			listDeployments: vi.fn(async () => ({
				data: [
					{ id: 1, environment: "Preview", production_environment: false },
					{ id: 2, environment: "Production", production_environment: true },
				],
			})),
			listDeploymentStatuses: vi.fn(async () => ({
				data: [{ state: "success", environment_url: "https://preview.example.test" }],
			})),
			getCombinedStatusForRef: vi.fn(async () => ({
				data: { statuses: [{ context: "deploy", state: "error", target_url: null }] },
			})),
		},
		checks: {
			listForRef: vi.fn(async () => ({
				data: { check_runs: [checkRun(1, "success"), checkRun(2, null), checkRun(3, "skipped")] },
			})),
			get: vi.fn(async () => ({ data: checkRun(2, "failure") })),
			listAnnotations: vi.fn(async () => ({
				data: [{ path: "a.ts", start_line: 3, message: "boom" }],
			})),
		},
		actions: {
			downloadJobLogsForWorkflowRun: vi.fn(async () => ({
				data: "2026-01-01T10:00:00.000Z \u001b[31mexpected 1\u001b[0m\n",
			})),
		},
	} satisfies PullClient;
}

describe("loadPull", () => {
	it("marks only code failures as fixable, and reports a conflict", async () => {
		const stub = client({ mergeable_state: "dirty" });
		stub.checks.listForRef.mockResolvedValue({
			data: { check_runs: [checkRun(1, "failure"), checkRun(2, "timed_out"), checkRun(3, "cancelled")] },
		});
		const pull = await loadPull(stub, "me/app", 4);
		expect(pull.checks.map((check) => check.fixable)).toEqual([true, true, false, false]);
		expect(pull).toMatchObject({ conflicts: true, baseSha: "a".repeat(40) });
	});

	it("combines check runs and commit statuses", async () => {
		const pull = await loadPull(client(), "me/app", 4);
		expect(pull.checks.map((check) => [check.name, check.state, check.checkRunId])).toEqual([
			["job 1", "passed", 1],
			["job 2", "pending", 2],
			["job 3", "skipped", 3],
			["deploy", "failed", null],
		]);
		expect(pull).toMatchObject({ status: "open", blocker: null, checksUnavailable: false });
		expect(summarizeChecks(pull.checks).tone).toBe("failed");
	});

	it("still shows the PR when the app may not read checks", async () => {
		const github = client();
		github.checks.listForRef.mockRejectedValue(httpError(403));
		expect(await loadPull(github, "me/app", 4)).toMatchObject({ checksUnavailable: true });
	});

	it("links the preview deployments of the commit, not production", async () => {
		expect((await loadPull(client(), "me/app", 4)).deployments).toEqual([
			{ id: 1, name: "Preview", url: "https://preview.example.test" },
		]);
	});

	it("shows no deployment link that is unfinished, unsafe or unreadable", async () => {
		for (const status of [
			{ state: "in_progress", environment_url: "https://preview.example.test" },
			{ state: "success", environment_url: "javascript:alert(1)" },
		]) {
			const github = client();
			github.repos.listDeploymentStatuses.mockResolvedValue({ data: [status] });
			expect((await loadPull(github, "me/app", 4)).deployments).toEqual([]);
		}
		const refused = client();
		refused.repos.listDeployments.mockRejectedValue(httpError(403));
		expect(await loadPull(refused, "me/app", 4)).toMatchObject({ deployments: [], checksUnavailable: false });
	});

	it("explains why an open PR cannot merge", async () => {
		for (const [change, text] of [
			[{ mergeable: false, mergeable_state: "dirty" }, "conflicts"],
			[{ mergeable_state: "blocked" }, "branch rule"],
			[{ mergeable: null, mergeable_state: "unknown" }, "still checking"],
			[{ draft: true }, "draft"],
		] as const) {
			expect((await loadPull(client(change), "me/app", 4)).blocker).toContain(text);
		}
		const merged = await loadPull(client({ merged: true, state: "closed" }), "me/app", 4);
		expect(merged).toMatchObject({ status: "merged", blocker: null });
	});
});

describe("mergePull", () => {
	it("merges the exact commit, squashing when allowed", async () => {
		const github = client();
		expect(await mergePull(github, "me/app", 4, SHA)).toEqual({ ok: true });
		expect(github.pulls.merge).toHaveBeenCalledWith({
			owner: "me",
			repo: "app",
			pull_number: 4,
			sha: SHA,
			merge_method: "squash",
		});
	});

	it("uses another method when squashing is off", async () => {
		const github = client();
		github.repos.get.mockResolvedValue({
			data: { allow_squash_merge: false, allow_merge_commit: false },
		});
		await mergePull(github, "me/app", 4, SHA);
		expect(github.pulls.merge.mock.calls[0]).toMatchObject([{ merge_method: "rebase" }]);
	});

	it("turns GitHub refusals into messages and passes on the rest", async () => {
		const github = client();
		github.pulls.merge.mockRejectedValueOnce(httpError(409));
		expect(await mergePull(github, "me/app", 4, SHA)).toMatchObject({
			ok: false,
			message: expect.stringContaining("changed"),
		});
		github.pulls.merge.mockRejectedValueOnce(httpError(500));
		await expect(mergePull(github, "me/app", 4, SHA)).rejects.toThrow("500");
	});
});

describe("failureReport", () => {
	it("sends the annotations and a clean log tail", async () => {
		const report = await failureReport(client(), "me/app", 4, 2);
		expect(report).toContain('"job 2" failed on pull request #4');
		expect(report).toContain("a.ts:3 boom");
		expect(report).toContain("End of the log:\nexpected 1");
		expect(report).not.toContain("\u001b");
	});

	it("still reports when logs and annotations are refused", async () => {
		const github = client();
		github.actions.downloadJobLogsForWorkflowRun.mockRejectedValue(httpError(403));
		github.checks.listAnnotations.mockRejectedValue(httpError(403));
		expect(await failureReport(github, "me/app", 4, 2)).toContain("Tests failed");
	});

	it("refuses a check from another commit or one that passed", async () => {
		const github = client();
		github.checks.get.mockResolvedValueOnce({ data: checkRun(2, "failure", "c".repeat(40)) });
		expect(await failureReport(github, "me/app", 4, 2)).toBeNull();
		github.checks.get.mockResolvedValueOnce({ data: checkRun(2, "success") });
		expect(await failureReport(github, "me/app", 4, 2)).toBeNull();
	});

	it("keeps huge logs within the message limit", async () => {
		const github = client();
		github.actions.downloadJobLogsForWorkflowRun.mockResolvedValue({ data: "x".repeat(100_000) });
		expect((await failureReport(github, "me/app", 4, 2))?.length).toBeLessThan(20_000);
	});
});

describe("handlePull", () => {
	const input = { userId: "user-1", chatId: "7d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d" };
	const deps = (found: Awaited<ReturnType<PullDeps["getChat"]>>) => ({
		getChat: vi.fn<PullDeps["getChat"]>(async () => found),
		loadPull: vi.fn<PullDeps["loadPull"]>(async () => ({ state: "none" })),
		merged: vi.fn<PullDeps["merged"]>(async () => {}),
	});

	it("never calls GitHub without a session or for someone else's chat", async () => {
		const fake = deps(null);
		expect((await handlePull(fake, { ...input, userId: undefined })).status).toBe(401);
		expect((await handlePull(fake, input)).status).toBe(404);
		expect(fake.loadPull).not.toHaveBeenCalled();
	});

	it("reports a merged pull request, and only a merged one", async () => {
		const found = { pullRequestNumber: 4, projectName: "me/app", installationId: 1 };
		const open = deps(found);
		open.loadPull.mockResolvedValue(await loadPull(client(), "me/app", 4));
		await handlePull(open, input);
		expect(open.merged).not.toHaveBeenCalled();

		const closed = deps(found);
		closed.loadPull.mockResolvedValue(await loadPull(client({ merged: true, state: "closed" }), "me/app", 4));
		closed.merged.mockRejectedValue(new Error("database away"));
		expect((await handlePull(closed, input)).status).toBe(200);
		expect(closed.merged).toHaveBeenCalledWith(input.userId, input.chatId);
	});

	it("answers without GitHub when there is no PR", async () => {
		const fake = deps({ pullRequestNumber: null, projectName: "me/app", installationId: 1 });
		expect(await (await handlePull(fake, input)).json()).toEqual({ state: "none" });
		expect(fake.loadPull).not.toHaveBeenCalled();
	});
});
