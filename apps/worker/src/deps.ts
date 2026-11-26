import { createDeepSeekModel, withFallback } from "@nullfuse/agent";
import { createDb } from "@nullfuse/db";
import type { RunnerDeps } from "@nullfuse/runner";
import { DaytonaDriver, DockerDriver, ensureDaytonaSnapshot, ensureSandboxImage } from "@nullfuse/sandbox";
import { decryptEnvValue, parseEncryptionKey } from "@nullfuse/secrets";
import { loadEnv } from "./env";
import { createPullRequestOpener, createTokenMinter } from "./github";
import { deepseekModelId } from "./models";

let cached: Promise<RunnerDeps> | undefined;

// Built once per worker process. Sandboxes use Docker for now; the hosted
// provider replaces the driver in lesson 6.9.
export function getDeps(): Promise<RunnerDeps> {
	cached ??= (async () => {
		const env = loadEnv();
		const key = parseEncryptionKey(env.ENV_ENCRYPTION_KEY);
		const mint = createTokenMinter({
			appId: env.GITHUB_APP_ID,
			privateKeyBase64: env.GITHUB_APP_PRIVATE_KEY_BASE64,
		});
		// Docker runs only where a Docker daemon is (a laptop or your own server); Trigger's cloud needs Daytona.
		let sandbox: Pick<RunnerDeps, "driver" | "image">;
		if (env.SANDBOX_DRIVER === "daytona" && env.DAYTONA_API_KEY) {
			const { client, snapshot } = await ensureDaytonaSnapshot(env.DAYTONA_API_KEY, env.DAYTONA_SNAPSHOT);
			sandbox = { driver: new DaytonaDriver({ client, snapshot }) };
		} else {
			sandbox = { driver: new DockerDriver(), image: await ensureSandboxImage() };
		}
		return {
			db: createDb(env.DATABASE_URL),
			...sandbox,
			createModel: (modelKey) => {
				const apiKey = env.DEEPSEEK_API_KEY;
				const primary = createDeepSeekModel(deepseekModelId(modelKey), { apiKey });
				if (!env.FALLBACK_MODEL || env.FALLBACK_MODEL === modelKey) return primary;
				return withFallback(primary, [createDeepSeekModel(deepseekModelId(env.FALLBACK_MODEL), { apiKey })]);
			},
			githubToken: mint,
			openPullRequest: createPullRequestOpener(mint),
			decryptEnvValue: (projectId, name, stored) => decryptEnvValue(key, projectId, name, stored),
			author: { name: env.RUN_AUTHOR_NAME, email: env.RUN_AUTHOR_EMAIL },
			maxRunningPerUser: env.MAX_RUNNING_PER_USER,
			maxDiskMb: env.RUN_MAX_DISK_MB,
			limits: {
				...(env.RUN_MAX_STEPS && { maxSteps: env.RUN_MAX_STEPS }),
				...(env.RUN_MAX_TOKENS && { maxTokens: env.RUN_MAX_TOKENS }),
			},
		};
	})();
	return cached;
}
