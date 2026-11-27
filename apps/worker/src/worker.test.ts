import { describe, expect, it } from "vitest";
import { loadEnv } from "./env";
import {
	createPullRequestOpener,
	createRecordingLinker,
	createTokenMinter,
	GitHubError,
	withRecordingSection,
} from "./github";
import { deepseekModelId } from "./models";

const valid = {
	DATABASE_URL: "postgres://user:pass@localhost:5432/db",
	GITHUB_APP_ID: "123",
	GITHUB_APP_PRIVATE_KEY_BASE64: "a2V5",
	ENV_ENCRYPTION_KEY: "a2V5",
	DEEPSEEK_API_KEY: "deepseek-key",
};

describe("loadEnv", () => {
	it("accepts a complete environment and fills in the commit author", () => {
		expect(loadEnv(valid)).toMatchObject({
			GITHUB_APP_ID: "123",
			RUN_AUTHOR_NAME: "Prefill Code",
			RUN_AUTHOR_EMAIL: "code@prefill.invalid",
		});
	});

	it("lets the commit author be set", () => {
		const env = loadEnv({ ...valid, RUN_AUTHOR_NAME: "Bot", RUN_AUTHOR_EMAIL: "bot@example.test" });
		expect(env.RUN_AUTHOR_NAME).toBe("Bot");
		expect(env.RUN_AUTHOR_EMAIL).toBe("bot@example.test");
	});

	it("fills in the run limits and lets them be set", () => {
		expect(loadEnv(valid)).toMatchObject({
			MAX_RUNNING_PER_USER: 5,
			RUN_MAX_DISK_MB: 2048,
			RUN_STALE_SECONDS: 90,
			RUN_MAX_ATTEMPTS: 3,
		});
		const env = loadEnv({ ...valid, MAX_RUNNING_PER_USER: "5", RUN_MAX_STEPS: "20", FALLBACK_MODEL: "deepseek-v4-pro" });
		expect(env).toMatchObject({ MAX_RUNNING_PER_USER: 5, RUN_MAX_STEPS: 20, FALLBACK_MODEL: "deepseek-v4-pro" });
		expect(() => loadEnv({ ...valid, RUN_STALE_SECONDS: "5" })).toThrow(/RUN_STALE_SECONDS/);
	});

	it("names every missing or invalid variable at once", () => {
		expect(() => loadEnv({ DATABASE_URL: "not a url" })).toThrow(/DATABASE_URL[\s\S]*DEEPSEEK_API_KEY/);
	});
});

describe("deepseekModelId", () => {
	it("maps the names the chat offers and refuses unknown ones", () => {
		expect(deepseekModelId("deepseek-v4-pro")).toBe("deepseek-v4-pro");
		expect(() => deepseekModelId("gpt-nonexistent")).toThrow("Unknown model: gpt-nonexistent");
	});
});

describe("createTokenMinter", () => {
	it("refuses a repository name without an owner before contacting GitHub", async () => {
		const mint = createTokenMinter({ appId: "1", privateKeyBase64: "a2V5" });
		await expect(mint({ installationId: 1, repository: "no-owner" })).rejects.toThrow(
			"Invalid repository name",
		);
	});
});

describe("sandbox driver settings", () => {
	it("uses Docker unless told otherwise, and needs a key for Daytona", () => {
		expect(loadEnv(valid)).toMatchObject({ SANDBOX_DRIVER: "docker", DAYTONA_SNAPSHOT: "nullfuse-sandbox" });
		expect(() => loadEnv({ ...valid, SANDBOX_DRIVER: "daytona" })).toThrow(/DAYTONA_API_KEY/);
		expect(loadEnv({ ...valid, SANDBOX_DRIVER: "daytona", DAYTONA_API_KEY: "k" }).SANDBOX_DRIVER).toBe("daytona");
	});
});

describe("createPullRequestOpener", () => {
	const input = { installationId: 1, repository: "me/repo", head: "nullfuse/chat-ab", base: "main", title: "T", body: "B" };
	const mint = async () => "tok";
	const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

	function fake(responses: Response[]) {
		const calls: { url: string; method: string; body?: string }[] = [];
		const fetcher = (async (url: string, init?: RequestInit) => {
			calls.push({ url, method: init?.method ?? "GET", body: init?.body as string | undefined });
			const next = responses.shift();
			if (!next) throw new Error("unexpected request");
			return next;
		}) as unknown as typeof fetch;
		return { calls, fetcher };
	}

	it("creates the PR when none is open", async () => {
		const { calls, fetcher } = fake([reply(200, []), reply(201, { number: 5, html_url: "https://github.com/me/repo/pull/5" })]);
		expect(await createPullRequestOpener(mint, fetcher)(input)).toEqual({ number: 5, url: "https://github.com/me/repo/pull/5" });
		expect(calls[0]?.url).toContain("head=me%3Anullfuse%2Fchat-ab");
		expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ title: "T", body: "B", head: "nullfuse/chat-ab", base: "main" });
	});

	it("reuses an open PR instead of creating another", async () => {
		const { calls, fetcher } = fake([reply(200, [{ number: 3, html_url: "https://github.com/me/repo/pull/3" }])]);
		expect(await createPullRequestOpener(mint, fetcher)(input)).toEqual({ number: 3, url: "https://github.com/me/repo/pull/3" });
		expect(calls).toHaveLength(1);
	});

	it("returns nothing while the branch has no commits beyond the base", async () => {
		const { fetcher } = fake([reply(200, []), reply(422, { message: "Validation Failed", errors: [{ message: "No commits between main and nullfuse/chat-ab" }] })]);
		expect(await createPullRequestOpener(mint, fetcher)(input)).toBeNull();
	});

	it("explains a missing permission", async () => {
		const { fetcher } = fake([reply(200, []), reply(403, { message: "Resource not accessible by integration" })]);
		await expect(createPullRequestOpener(mint, fetcher)(input)).rejects.toThrow(/Pull requests: Read and write/);
	});

	it("passes other errors on", async () => {
		const { fetcher } = fake([reply(500, { message: "boom" })]);
		await expect(createPullRequestOpener(mint, fetcher)(input)).rejects.toBeInstanceOf(GitHubError);
	});
});

describe("recording link", () => {
	it("adds a section once and replaces it later, keeping the rest", () => {
		const first = withRecordingSection("What changed.", "https://app.test/a", true);
		const second = withRecordingSection(`${first}\n\nReviewer note`, "https://app.test/b", false);
		expect(second).toContain("What changed.");
		expect(second).toContain("Reviewer note");
		expect(second).toContain("https://app.test/b");
		expect(second).toContain("checks failed");
		expect(second).not.toContain("https://app.test/a");
		expect(second.match(/### Proof/g)).toHaveLength(1);
	});

	it("updates only the PR description", async () => {
		const sent: { method?: string; body?: string }[] = [];
		const fetcher = (async (_url: string, init: { method?: string; body?: string }) => {
			sent.push(init);
			return new Response(JSON.stringify({ body: "B" }), { status: 200 });
		}) as unknown as typeof fetch;
		await createRecordingLinker(async () => "token", "https://app.test", fetcher)({
			installationId: 1,
			repository: "me/repo",
			number: 2,
			chatId: "c",
			runId: "r",
			passed: true,
		});
		expect(sent[1]?.method).toBe("PATCH");
		const body = JSON.parse(sent[1]?.body ?? "{}");
		expect(Object.keys(body)).toEqual(["body"]);
		expect(body.body).toContain("https://app.test/api/chats/c/runs/r/video");
	});
});
