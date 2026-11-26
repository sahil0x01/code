import { createDeepSeekModel, withFallback } from "@nullfuse/agent";
import { createDb } from "@nullfuse/db";
import type { RunnerDeps } from "@nullfuse/runner";
import {
	DaytonaDriver,
	DockerDriver,
	ensureDaytonaRecordingSnapshot,
	ensureDaytonaSnapshot,
	ensureRecordingImage,
	ensureSandboxImage,
} from "@nullfuse/sandbox";
import { decryptEnvValue, parseEncryptionKey } from "@nullfuse/secrets";
import { createR2Store, r2ConfigFrom } from "@nullfuse/storage";
import { loadEnv } from "./env";
import { createPullRequestOpener, createRecordingLinker, createTokenMinter } from "./github";
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
		let recordingImage: () => Promise<string> = ensureRecordingImage;
		if (env.SANDBOX_DRIVER === "daytona" && env.DAYTONA_API_KEY) {
			const apiKey = env.DAYTONA_API_KEY;
			recordingImage = async () => (await ensureDaytonaRecordingSnapshot(apiKey)).snapshot;
			const { client, snapshot } = await ensureDaytonaSnapshot(env.DAYTONA_API_KEY, env.DAYTONA_SNAPSHOT);
			sandbox = { driver: new DaytonaDriver({ client, snapshot }) };
		} else {
			sandbox = { driver: new DockerDriver(), image: await ensureSandboxImage() };
		}
		const r2 = r2ConfigFrom(env);
		const store = r2 && createR2Store(r2);
		return {
			browserImage: recordingImage,
			liveUpdates: true,
			...(store && {
				recorder: {
					uploadUrl: (key: string) => store.uploadUrl(key),
					...(env.APP_URL && { linkPullRequest: createRecordingLinker(mint, env.APP_URL) }),
				},
			}),
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
