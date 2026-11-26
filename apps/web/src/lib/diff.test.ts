import { describe, expect, it, vi } from "vitest";
import { parsePatch } from "./diff";
import { type DiffDeps, handleDiff } from "./diff-handler";
import { type DiffClient, type DiffRequest, loadDiff } from "./diff-source";
import { anchorFor, formatReview, isOutdated } from "./review";

const patch = [
	"@@ -10,3 +10,4 @@ export function check(email) {",
	" const a = 1;",
	'-return email.includes("@");',
	"+const host = email;",
	"+return !!host;",
	" }",
	"\\ No newline at end of file",
].join("\n");

const file = { path: "src/signup.ts", status: "modified", additions: 2, deletions: 1, patch };

describe("parsePatch", () => {
	it("numbers both sides of each line", () => {
		const [hunk] = parsePatch(patch);
		expect(hunk?.lines.map((line) => [line.type, line.oldLine, line.newLine])).toEqual([
			["context", 10, 10],
			["remove", 11, null],
			["add", null, 11],
			["add", null, 12],
			["context", 12, 13],
		]);
	});

	it("restarts numbering at each hunk and handles headers without counts", () => {
		const hunks = parsePatch("@@ -1 +1 @@\n-a\n+b\n@@ -20,1 +30,1 @@\n c");
		expect(hunks).toHaveLength(2);
		expect(hunks[1]?.lines[0]).toMatchObject({ oldLine: 20, newLine: 30, text: "c" });
	});

	it("keeps content that looks like a marker", () => {
		const [hunk] = parsePatch("@@ -1,2 +1,2 @@\n--- old\n+++ new");
		expect(hunk?.lines.map((line) => line.text)).toEqual(["-- old", "++ new"]);
	});
});

describe("review comments", () => {
	const lines = parsePatch(patch)[0]?.lines ?? [];
	const comment = (index: number, body: string) => {
		const line = lines[index];
		if (!line) throw new Error("no line");
		return { ...anchorFor(file.path, line), body };
	};

	it("anchors removed lines to the old file", () => {
		expect(comment(1, "x")).toMatchObject({ side: "old", line: 11 });
		expect(comment(2, "x")).toMatchObject({ side: "new", line: 11 });
	});

	it("marks a draft outdated when its line changes or its file leaves", () => {
		const draft = comment(3, "x");
		expect(isOutdated(draft, [file])).toBe(false);
		expect(isOutdated({ ...draft, code: "something else" }, [file])).toBe(true);
		expect(isOutdated(draft, [])).toBe(true);
	});

	it("writes one message in line order with the quoted code", () => {
		const text = formatReview([comment(3, " Reject a trailing dot. "), comment(1, "Why remove?")], [file]);
		expect(text).toBe(
			[
				"Please address these review comments:",
				'src/signup.ts, removed line 11\n> return email.includes("@");\nWhy remove?',
				"src/signup.ts, line 12\n> return !!host;\nReject a trailing dot.",
			].join("\n\n"),
		);
		expect(formatReview([comment(3, "x")], [])).toContain("the code has changed");
	});
});

const HEAD = "a".repeat(40);
const notFound = Object.assign(new Error("Not Found"), { status: 404 });
const raw = (filename: string) => ({ filename, status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" });

function client({
	branch = true,
	compared = [raw("a.ts")],
	merged = false,
	pull = [raw("from-pr.ts")],
} = {}) {
	return {
		repos: {
			getBranch: vi.fn(async () => {
				if (!branch) throw notFound;
				return { data: { commit: { sha: HEAD } } };
			}),
			compareCommitsWithBasehead: vi.fn(async () => ({ data: { files: compared } })),
		},
		pulls: {
			get: vi.fn(async () => ({ data: { merged, head: { sha: HEAD } } })),
			listFiles: vi.fn(async ({ page }: { page: number }) => ({
				data: pull.slice((page - 1) * 100, page * 100),
			})),
		},
	} satisfies DiffClient;
}

const request: DiffRequest = {
	fullName: "me/app",
	baseBranch: "main",
	workingBranch: "nullfuse/chat-1",
	pullNumber: null,
};

describe("loadDiff", () => {
	it("compares the base branch with the head commit", async () => {
		const github = client();
		const diff = await loadDiff(github, request);
		expect(diff).toMatchObject({ state: "ok", headSha: HEAD, truncated: false, files: [{ path: "a.ts" }] });
		expect(github.repos.compareCommitsWithBasehead).toHaveBeenCalledWith({
			owner: "me",
			repo: "app",
			basehead: `main...${HEAD}`,
		});
	});

	it("skips the comparison when the browser already has this commit", async () => {
		const github = client();
		expect(await loadDiff(github, { ...request, knownHead: HEAD })).toEqual({ state: "unchanged" });
		expect(github.repos.compareCommitsWithBasehead).not.toHaveBeenCalled();
	});

	it("says nothing is pushed when the branch is missing and there is no PR", async () => {
		expect(await loadDiff(client({ branch: false }), request)).toEqual({ state: "not_pushed" });
	});

	it("reads the PR when its branch was deleted or already merged", async () => {
		for (const github of [client({ branch: false }), client({ compared: [], merged: true })]) {
			const diff = await loadDiff(github, { ...request, pullNumber: 4 });
			expect(diff).toMatchObject({ files: [{ path: "from-pr.ts" }], url: "https://github.com/me/app/pull/4/files" });
		}
	});

	it("flags an incomplete list and stops paging at the limit", async () => {
		const many = Array.from({ length: 450 }, (_, index) => raw(`${index}.ts`));
		const github = client({ branch: false, pull: many });
		expect(await loadDiff(github, { ...request, pullNumber: 4 })).toMatchObject({ truncated: true });
		expect(github.pulls.listFiles).toHaveBeenCalledTimes(3);
	});

	it("passes other GitHub errors on", async () => {
		const github = client();
		github.repos.getBranch.mockRejectedValue(Object.assign(new Error("limit"), { status: 403 }));
		await expect(loadDiff(github, request)).rejects.toThrow("limit");
	});
});

describe("handleDiff", () => {
	const chatId = "7d444840-9dc0-41d1-9c3a-5f0e8b1a2c3d";
	const chat = {
		baseBranch: "main",
		workingBranch: "nullfuse/chat-1",
		pullRequestNumber: null,
		projectName: "me/app",
		installationId: 7,
	};
	const deps = (found: Awaited<ReturnType<DiffDeps["getChat"]>> = chat) => ({
		getChat: vi.fn<DiffDeps["getChat"]>(async () => found),
		loadDiff: vi.fn<DiffDeps["loadDiff"]>(async () => ({ state: "unchanged" })),
	});
	const input = { userId: "user-1", chatId, head: null };

	it("refuses a visitor who is not signed in", async () => {
		const fake = deps();
		const response = await handleDiff(fake, { ...input, userId: undefined });
		expect(response.status).toBe(401);
		expect(fake.getChat).not.toHaveBeenCalled();
	});

	it("never calls GitHub for a chat the user does not own", async () => {
		const fake = deps(null);
		const response = await handleDiff(fake, input);
		expect(response.status).toBe(404);
		expect(fake.getChat).toHaveBeenCalledWith("user-1", chatId);
		expect(fake.loadDiff).not.toHaveBeenCalled();
	});

	it("rejects a malformed chat id before touching the database", async () => {
		const fake = deps();
		expect((await handleDiff(fake, { ...input, chatId: "nope" })).status).toBe(404);
		expect(fake.getChat).not.toHaveBeenCalled();
	});

	it("answers without GitHub when disconnected or nothing is pushed", async () => {
		for (const [found, state] of [
			[{ ...chat, installationId: null }, "disconnected"],
			[{ ...chat, workingBranch: null }, "not_pushed"],
		] as const) {
			const fake = deps(found);
			expect(await (await handleDiff(fake, input)).json()).toEqual({ state });
			expect(fake.loadDiff).not.toHaveBeenCalled();
		}
	});

	it("ignores a head that is not a commit id and is never cached", async () => {
		const fake = deps();
		const response = await handleDiff(fake, { ...input, head: "../x" });
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(fake.loadDiff.mock.calls[0]?.[1].knownHead).toBeUndefined();
	});

	it("hides GitHub's error details", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fake = deps();
		fake.loadDiff.mockRejectedValue(new Error("secret detail"));
		const response = await handleDiff(fake, input);
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain("secret detail");
		vi.restoreAllMocks();
	});
});
