import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.url(),
		BETTER_AUTH_SECRET: z.string().min(32),
		GITHUB_CLIENT_ID: z.string().min(1),
		GITHUB_CLIENT_SECRET: z.string().min(1),
		GITHUB_APP_ID: z.string().min(1),
		GITHUB_APP_SLUG: z.string().min(1),
		GITHUB_APP_WEBHOOK_SECRET: z.string().min(16),
		GITHUB_APP_PRIVATE_KEY_BASE64: z.string().min(1),
		ENV_ENCRYPTION_KEY: z
			.string()
			.refine(
				(value) => Buffer.from(value, "base64").length === 32,
				"Must be 32 bytes, base64 encoded",
			),
		// For self-hosting: lets users add a model server on your own network.
		ALLOW_PRIVATE_MODEL_URLS: z.stringbool().default(false),
		// Without it, messages are saved and runs stay queued.
		TRIGGER_SECRET_KEY: z.string().min(1).optional(),
		// "Connect Slack" appears only when all three are set.
		SLACK_CLIENT_ID: z.string().min(1).optional(),
		SLACK_CLIENT_SECRET: z.string().min(1).optional(),
		SLACK_SIGNING_SECRET: z.string().min(1).optional(),
		// "Connect Discord" appears only when all four are set.
		DISCORD_APPLICATION_ID: z.string().min(1).optional(),
		DISCORD_PUBLIC_KEY: z.string().min(1).optional(),
		DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
		DISCORD_BOT_TOKEN: z.string().min(1).optional(),
		// "Connect Telegram" appears only when all three are set.
		TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
		TELEGRAM_BOT_USERNAME: z.string().min(1).optional(),
		TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[\w-]{16,256}$/).optional(),
		// Screen recordings can be watched only when all four are set.
		R2_ACCOUNT_ID: z.string().min(1).optional(),
		R2_BUCKET: z.string().min(1).optional(),
		R2_ACCESS_KEY_ID: z.string().min(1).optional(),
		R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
	},
	client: {
		NEXT_PUBLIC_APP_URL: z.url(),
	},
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
		GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
		GITHUB_APP_ID: process.env.GITHUB_APP_ID,
		GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
		GITHUB_APP_WEBHOOK_SECRET: process.env.GITHUB_APP_WEBHOOK_SECRET,
		GITHUB_APP_PRIVATE_KEY_BASE64: process.env.GITHUB_APP_PRIVATE_KEY_BASE64,
		ENV_ENCRYPTION_KEY: process.env.ENV_ENCRYPTION_KEY,
		ALLOW_PRIVATE_MODEL_URLS: process.env.ALLOW_PRIVATE_MODEL_URLS,
		TRIGGER_SECRET_KEY: process.env.TRIGGER_SECRET_KEY,
		SLACK_CLIENT_ID: process.env.SLACK_CLIENT_ID,
		SLACK_CLIENT_SECRET: process.env.SLACK_CLIENT_SECRET,
		SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET,
		DISCORD_APPLICATION_ID: process.env.DISCORD_APPLICATION_ID,
		DISCORD_PUBLIC_KEY: process.env.DISCORD_PUBLIC_KEY,
		DISCORD_CLIENT_SECRET: process.env.DISCORD_CLIENT_SECRET,
		DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
		TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
		TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
		TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
		R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
		R2_BUCKET: process.env.R2_BUCKET,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
	},
	emptyStringAsUndefined: true,
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
