import { createDeepSeekModel, withFallback } from "@nullfuse/agent";
import { createDb } from "@nullfuse/db";
import type { RunnerDeps } from "@nullfuse/runner";
import {
	Agent37Driver,
	agent37Templates,
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
import { deepseekModelId, ownModels } from "./models";
import { allowedDomains } from "./network";

// Daytona's list prices, read 2026-11-27: $0.0504 per vCPU hour and $0.0162 per GiB hour,
// for the plain sandbox (1 vCPU, 1 GiB) and the browser one (2 vCPU, 2 GiB).
const DAYTONA_HOURLY_COST = { plain: 66_600, browser: 133_200 };

// Agent37's list prices, read 2026-11-28: $0.80 per vCPU, $0.70 per GiB of memory and $0.09
// per GiB of disk for 730 hours, for its smallest shape (2 vCPU, 4 GiB, 4 GiB disk).
const AGENT37_HOURLY_COST = { plain: 6_521, browser: 6_521 };

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
		let sandboxHourlyCost: RunnerDeps["sandboxHourlyCost"];
		if (env.SANDBOX_DRIVER === "agent37" && env.AGENT37_API_KEY) {
			// Names are worked out only when not given, since that reads the Dockerfiles.
			const plain = env.AGENT37_TEMPLATE ?? agent37Templates().plain;
			recordingImage = async () => env.AGENT37_BROWSER_TEMPLATE ?? agent37Templates().browser;
			sandbox = { driver: new Agent37Driver({ apiKey: env.AGENT37_API_KEY, template: plain }) };
			sandboxHourlyCost = AGENT37_HOURLY_COST;
		} else if (env.SANDBOX_DRIVER === "daytona" && env.DAYTONA_API_KEY) {
			const apiKey = env.DAYTONA_API_KEY;
			recordingImage = async () => (await ensureDaytonaRecordingSnapshot(apiKey)).snapshot;
			const { client, snapshot } = await ensureDaytonaSnapshot(env.DAYTONA_API_KEY, env.DAYTONA_SNAPSHOT);
			sandbox = { driver: new DaytonaDriver({ client, snapshot }) };
			sandboxHourlyCost = DAYTONA_HOURLY_COST;
		} else {
			sandbox = { driver: new DockerDriver(), image: await ensureSandboxImage() };
		}
		const db = createDb(env.DATABASE_URL);
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
			db,
			ownModel: ownModels(db, key, env.ALLOW_PRIVATE_MODEL_URLS),
			...sandbox,
			allowedDomains: allowedDomains(env),
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
			sandboxHourlyCost,
			limits: {
				maxCost: Math.round(env.RUN_MAX_COST_USD * 1_000_000),
				...(env.RUN_MAX_STEPS && { maxSteps: env.RUN_MAX_STEPS }),
				...(env.RUN_MAX_TOKENS && { maxTokens: env.RUN_MAX_TOKENS }),
			},
		};
	})();
	return cached;
}
