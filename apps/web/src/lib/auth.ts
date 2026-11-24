import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/env";
import { db } from "@/server/db";
import { deleteWaitlistEntry } from "@nullfuse/db";

export const auth = betterAuth({
	baseURL: env.NEXT_PUBLIC_APP_URL,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: "pg" }),
	socialProviders: {
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
		},
	},
	rateLimit: {
		enabled: true,
		storage: "database",
		window: 60,
		max: 60,
	},
	session: {
		freshAge: 60 * 5,
	},
	account: {
		encryptOAuthTokens: true,
	},
	user: {
		deleteUser: {
			enabled: true,
			afterDelete: async (user) => {
				await deleteWaitlistEntry(db, user.email);
			},
		},
	},
	plugins: [nextCookies()],
});
