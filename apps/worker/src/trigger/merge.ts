import { runMerges } from "@nullfuse/connectors/pulls";
import { idempotencyKeys, logger, schedules, tasks } from "@trigger.dev/sdk";
import { App } from "octokit";
import { getDeps } from "../deps";
import { loadEnv } from "../env";

/** Finishes merges that are waiting for checks or a fix. */
export const mergeTask = schedules.task({
	id: "merge-pulls",
	cron: { pattern: "* * * * *", window: "1m" },
	// Two passes at once would only ask GitHub the same things twice.
	queue: { concurrencyLimit: 1 },
	run: async () => {
		const env = loadEnv();
		const { db } = await getDeps();
		const app = new App({
			appId: env.GITHUB_APP_ID,
			privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
		});

		const result = await runMerges(
			{
				db,
				github: async (installationId) => (await app.getInstallationOctokit(installationId)).rest,
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
			{ olderThanMs: 30_000, limit: 50 },
		);
		if (result.failed.length > 0) logger.warn("Some merges could not be checked", { failed: result.failed });
		return { checked: result.checked };
	},
});
