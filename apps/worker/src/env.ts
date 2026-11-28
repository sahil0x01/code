import { z } from "zod";

const schema = z.object({
	DATABASE_URL: z.url(),
	GITHUB_APP_ID: z.string().min(1),
	GITHUB_APP_PRIVATE_KEY_BASE64: z.string().min(1),
	ENV_ENCRYPTION_KEY: z.string().min(1),
	DEEPSEEK_API_KEY: z.string().min(1),
	RUN_AUTHOR_NAME: z.string().min(1).default("Prefill Code"),
	// .invalid is reserved, so this can never be mistaken for a real address.
	RUN_AUTHOR_EMAIL: z.string().min(1).default("code@prefill.invalid"),
	SANDBOX_DRIVER: z.enum(["docker", "daytona", "agent37"]).default("docker"),
	AGENT37_API_KEY: z.string().min(1).optional(),
	// Template names, when not the ones the build script gives this code's Dockerfiles.
	AGENT37_TEMPLATE: z.string().min(1).optional(),
	AGENT37_BROWSER_TEMPLATE: z.string().min(1).optional(),
	DAYTONA_API_KEY: z.string().min(1).optional(),
	DAYTONA_SNAPSHOT: z.string().min(1).default("nullfuse-sandbox"),
	// "restricted" limits sandboxes to code hosts and package registries. The default for Docker.
	SANDBOX_NETWORK: z.enum(["open", "restricted"]).optional(),
	// More domains a restricted sandbox may reach, comma separated.
	SANDBOX_ALLOW_DOMAINS: z.string().optional(),
	MAX_RUNNING_PER_USER: z.coerce.number().int().positive().default(5),
	RUN_MAX_DISK_MB: z.coerce.number().int().positive().default(2048),
	RUN_MAX_STEPS: z.coerce.number().int().positive().optional(),
	RUN_MAX_TOKENS: z.coerce.number().int().positive().optional(),
	RUN_MAX_COST_USD: z.coerce.number().positive().max(2000).default(1),
	// A running run that has not reported in for this long is taken to have crashed.
	RUN_STALE_SECONDS: z.coerce.number().int().min(30).default(90),
	// A run is given up after its worker died this many times.
	RUN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
	// A chat model name (see models.ts) used when the chosen model keeps failing.
	FALLBACK_MODEL: z.string().min(1).optional(),
	// Screen recordings are on only when all four R2 values are set.
	R2_ACCOUNT_ID: z.string().optional(),
	R2_BUCKET: z.string().optional(),
	R2_ACCESS_KEY_ID: z.string().optional(),
	R2_SECRET_ACCESS_KEY: z.string().optional(),
	// For self-hosting: lets users add a model server on your own network.
	ALLOW_PRIVATE_MODEL_URLS: z.stringbool().default(false),
	// To answer tasks sent from these tools. Slack and GitHub need nothing here.
	DISCORD_BOT_TOKEN: z.string().min(1).optional(),
	TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
	// Where the web app lives, to link to it from pull requests and replies.
	APP_URL: z.url().optional(),
});

export type WorkerEnv = z.infer<typeof schema>;

const checked = schema
	.refine((env) => env.SANDBOX_DRIVER !== "daytona" || env.DAYTONA_API_KEY, {
		path: ["DAYTONA_API_KEY"],
		message: "Required when SANDBOX_DRIVER is daytona",
	})
	.refine((env) => env.SANDBOX_DRIVER !== "agent37" || env.AGENT37_API_KEY, {
		path: ["AGENT37_API_KEY"],
		message: "Required when SANDBOX_DRIVER is agent37",
	});

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
	const parsed = checked.safeParse(source);
	if (!parsed.success) {
		throw new Error(`Invalid worker environment:\n${z.prettifyError(parsed.error)}`);
	}
	return parsed.data;
}
