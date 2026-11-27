import { createAppAuth } from "@octokit/auth-app";

export function createTokenMinter(options: { appId: string; privateKeyBase64: string }) {
	const auth = createAppAuth({
		appId: options.appId,
		privateKey: Buffer.from(options.privateKeyBase64, "base64").toString("utf8"),
	});

	// Limited to the one repository, its contents and its pull requests.
	return async (input: { installationId: number; repository: string }) => {
		const name = input.repository.split("/")[1];
		if (!name) throw new Error(`Invalid repository name: ${input.repository}`);
		const result = await auth({
			type: "installation",
			installationId: input.installationId,
			repositoryNames: [name],
			permissions: { contents: "write", pull_requests: "write" },
		});
		return result.token;
	};
}

const API = "https://api.github.com";

type Mint = ReturnType<typeof createTokenMinter>;

type PullRequestRequest = {
	installationId: number;
	repository: string;
	head: string;
	base: string;
	title: string;
	body: string;
};

export class GitHubError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "GitHubError";
	}
}

async function call(token: string, path: string, init: { method?: string; body?: unknown } = {}, fetcher = fetch) {
	const response = await fetcher(`${API}${path}`, {
		method: init.method ?? "GET",
		headers: {
			authorization: `Bearer ${token}`,
			accept: "application/vnd.github+json",
			"x-github-api-version": "2022-11-28",
			"content-type": "application/json",
		},
		body: init.body === undefined ? undefined : JSON.stringify(init.body),
	});
	const data = (await response.json().catch(() => ({}))) as {
		message?: string;
		errors?: { message?: string }[];
	};
	if (!response.ok) {
		const detail = data.errors?.map((e) => e.message).filter(Boolean).join("; ");
		throw new GitHubError([data.message, detail].filter(Boolean).join(": ") || `GitHub returned ${response.status}`, response.status);
	}
	return data;
}

// One PR per chat branch: reuses an open one if it exists, and returns null while the
// branch has no commits beyond the base, so there is nothing to propose.
export function createPullRequestOpener(mint: Mint, fetcher: typeof fetch = fetch) {
	return async (input: PullRequestRequest): Promise<{ number: number; url: string } | null> => {
		const token = await mint({ installationId: input.installationId, repository: input.repository });
		const owner = input.repository.split("/")[0] ?? "";

		const open = (await call(
			token,
			`/repos/${input.repository}/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.head}`)}`,
			{},
			fetcher,
		)) as unknown as { number: number; html_url: string }[];
		const existing = open[0];
		if (existing) return { number: existing.number, url: existing.html_url };

		try {
			const created = (await call(
				token,
				`/repos/${input.repository}/pulls`,
				{ method: "POST", body: { title: input.title, body: input.body, head: input.head, base: input.base } },
				fetcher,
			)) as unknown as { number: number; html_url: string };
			return { number: created.number, url: created.html_url };
		} catch (error) {
			if (error instanceof GitHubError && error.status === 422 && /no commits between/i.test(error.message)) {
				return null;
			}
			if (error instanceof GitHubError && error.status === 403) {
				throw new GitHubError(
					`${error.message}. The GitHub App needs the "Pull requests: Read and write" permission, accepted on the installation.`,
					403,
				);
			}
			throw error;
		}
	};
}

const SECTION = /\n*<!-- nullfuse-recording -->[\s\S]*?<!-- \/nullfuse-recording -->/;

/** Replaces only the recording section of a PR description, leaving the rest as written. */
export function withRecordingSection(body: string, link: string, passed: boolean) {
	const section = `<!-- nullfuse-recording -->\n### Proof\n[See the latest video and screenshots](${link}) (${
		passed ? "the script's checks passed" : "the script's checks failed"
	}; sign-in required, kept for 30 days).\n<!-- /nullfuse-recording -->`;
	return `${body.replace(SECTION, "").trimEnd()}\n\n${section}`.trim();
}

export function createRecordingLinker(mint: Mint, appUrl: string, fetcher: typeof fetch = fetch) {
	return async (input: {
		installationId: number;
		repository: string;
		number: number;
		chatId: string;
		runId: string;
		passed: boolean;
	}) => {
		const token = await mint({ installationId: input.installationId, repository: input.repository });
		const path = `/repos/${input.repository}/pulls/${input.number}`;
		const pull = (await call(token, path, {}, fetcher)) as unknown as { body: string | null };
		const link = new URL(`/api/chats/${input.chatId}/runs/${input.runId}/video`, appUrl).href;
		await call(
			token,
			path,
			{ method: "PATCH", body: { body: withRecordingSection(pull.body ?? "", link, input.passed) } },
			fetcher,
		);
	};
}
