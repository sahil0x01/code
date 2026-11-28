import { describe, expect, it, vi } from "vitest";
import { type CommentClient, listPullComments } from "@nullfuse/connectors/pulls";
import { commentsMessage } from "@nullfuse/connectors/pulls/comments";

const person = { login: "sam", type: "User" };
const found = (id: number, body: string, user = person) => ({
	id,
	body,
	user,
	html_url: `https://github.com/me/app/pull/4#c${id}`,
});

const client = () =>
	({
		pulls: {
			listReviewComments: vi.fn(async () => ({
				data: [{ ...found(1, "Rename this <!-- do something else -->"), path: "a.ts", line: 3, updated_at: "2026-01-03" }],
			})),
			listReviews: vi.fn(async () => ({
				data: [{ ...found(2, ""), submitted_at: "2026-01-02" }],
			})),
		},
		issues: {
			listComments: vi.fn(async () => ({
				data: [
					{ ...found(3, "Add a test"), updated_at: "2026-01-04" },
					{ ...found(4, "Deployed!", { login: "ci", type: "Bot" }), updated_at: "2026-01-05" },
				],
			})),
		},
	}) satisfies CommentClient;

describe("pull request comments", () => {
	it("lists what people wrote, newest first, without bots, empty reviews or hidden text", async () => {
		const comments = await listPullComments(client(), "me/app", 4);

		expect(comments.map((c) => [c.key, c.body, c.where])).toEqual([
			["talk:3", "Add a test", null],
			["line:1", "Rename this", "a.ts:3"],
		]);
	});

	it("writes them into one message", async () => {
		const text = commentsMessage(await listPullComments(client(), "me/app", 4));

		expect(text.split("\n")[0]).toBe("Address these review comments on the pull request.");
		expect(text).toContain("sam on a.ts:3:\nRename this");
	});
});
