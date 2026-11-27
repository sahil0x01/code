import { sendDiscordMessage, sendReports, sendTelegramMessage, postSlackMessage, type ReportDeps } from "@nullfuse/connectors";
import { decryptConnectorToken, parseEncryptionKey } from "@nullfuse/secrets";
import { logger } from "@trigger.dev/sdk";
import { getDeps } from "./deps";
import { loadEnv, type WorkerEnv } from "./env";
import { createCommenter } from "./github";

function senders(env: WorkerEnv): ReportDeps["senders"] {
	const key = parseEncryptionKey(env.ENV_ENCRYPTION_KEY);
	const comment = createCommenter({ appId: env.GITHUB_APP_ID, privateKeyBase64: env.GITHUB_APP_PRIVATE_KEY_BASE64 });
	const { DISCORD_BOT_TOKEN: discord, TELEGRAM_BOT_TOKEN: telegram } = env;
	return {
		slack: async (report, text) => {
			if (!report.tokenEncrypted) throw new Error("The Slack link has no token");
			await postSlackMessage({
				token: decryptConnectorToken(key, report, report.tokenEncrypted),
				channel: report.externalUserId,
				text,
			});
		},
		github: async (report, text) => {
			if (report.installationId === null || !report.target) throw new Error("The project is disconnected");
			await comment({
				installationId: report.installationId,
				repository: report.projectName,
				number: Number(report.target),
				body: text,
			});
		},
		...(discord && {
			discord: async (report, text) => sendDiscordMessage({ botToken: discord, userId: report.externalUserId, text }),
		}),
		...(telegram && {
			telegram: async (report, text) =>
				sendTelegramMessage({ botToken: telegram, chatId: report.externalUserId, text }),
		}),
	};
}

/** Answers tasks that came from outside tools. It must never fail the task around it. */
export async function reportToConnectors(runId?: string) {
	try {
		const env = loadEnv();
		const { db } = await getDeps();
		const result = await sendReports({ db, appUrl: env.APP_URL, senders: senders(env) }, { runId });
		if (result.failed.length > 0) logger.warn("Some replies were not sent", { failed: result.failed.slice(0, 5) });
	} catch (error) {
		logger.warn("Could not send replies", { error: error instanceof Error ? error.message : String(error) });
	}
}
