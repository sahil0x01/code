import { runAutoFix } from "@nullfuse/connectors/pulls";
import { idempotencyKeys, logger, schedules, tasks } from "@trigger.dev/sdk";
import { App } from "octokit";
import { getDeps } from "../deps";
import { loadEnv } from "../env";

export const autoFixTask = schedules.task({
	id: "auto-fix",
	cron: { pattern: "*/2 * * * *", window: "2m" },
	// Two passes at once would only ask GitHub the same things twice.
	queue: { concurrencyLimit: 1 },
	run: async () => {
		const env = loadEnv();
		const { db } = await getDeps();
		const app = new App({
			appId: env.GITHUB_APP_ID,
			privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
		});

		const result = await runAutoFix(
			{
				db,
				maxRuns: env.AUTOFIX_MAX_RUNS,
				maxCost: Math.round(env.AUTOFIX_MAX_COST_USD * 1_000_000),
				github: async (installationId) => {
					const { rest } = await app.getInstallationOctokit(installationId);
					return {
						client: rest,
						canWrite: async (fullName, login) => {
							const [owner = "", repo = ""] = fullName.split("/");
							try {
								const { data } = await rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
								return data.permission === "admin" || data.permission === "write";
							} catch (error) {
								if (typeof error === "object" && error && "status" in error && error.status === 404) return false;
								throw error;
							}
						},
					};
				},
				// If this fails the run stays queued, and the run sweep sends it again.
				enqueue: async ({ runId, chatId }) => {
					await tasks.trigger(
						"run-agent",
						{ runId },
						{
							idempotencyKey: await idempotencyKeys.create(runId, { scope: "global" }),
							concurrencyKey: chatId,
						},
					);
				},
			},
			{ olderThanMs: 60_000, limit: 50 },
		);
		if (result.queued > 0 || result.failed.length > 0) logger.info("Auto-fix", result);
		return { checked: result.checked, queued: result.queued };
	},
});
