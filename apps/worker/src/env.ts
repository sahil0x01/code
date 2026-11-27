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
	SANDBOX_DRIVER: z.enum(["docker", "daytona"]).default("docker"),
	DAYTONA_API_KEY: z.string().min(1).optional(),
	DAYTONA_SNAPSHOT: z.string().min(1).default("nullfuse-sandbox"),
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
	// Where the web app lives, to link recordings from pull requests.
	APP_URL: z.url().optional(),
});

export type WorkerEnv = z.infer<typeof schema>;

const checked = schema.refine((env) => env.SANDBOX_DRIVER !== "daytona" || env.DAYTONA_API_KEY, {
	path: ["DAYTONA_API_KEY"],
	message: "Required when SANDBOX_DRIVER is daytona",
});

export function loadEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
	const parsed = checked.safeParse(source);
	if (!parsed.success) {
		throw new Error(`Invalid worker environment:\n${z.prettifyError(parsed.error)}`);
	}
	return parsed.data;
}
