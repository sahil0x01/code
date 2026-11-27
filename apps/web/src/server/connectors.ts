import "server-only";
import {
	discordAuthorizeUrl,
	exchangeDiscordCode,
	exchangeSlackCode,
	slackAuthorizeUrl,
} from "@nullfuse/connectors";
import { saveConnection } from "@nullfuse/db";
import { env } from "@/env";
import { db } from "@/server/db";
import { encryptConnectorToken } from "@/server/secrets";

export const STATE_COOKIE = "connector_state";

const redirectUri = (provider: string) =>
	new URL(`/api/connectors/${provider}/callback`, env.NEXT_PUBLIC_APP_URL).toString();

/** Each of these is null unless this server has that app set up. */
export function slackConfig() {
	const { SLACK_CLIENT_ID: clientId, SLACK_CLIENT_SECRET: clientSecret, SLACK_SIGNING_SECRET: signingSecret } = env;
	if (!clientId || !clientSecret || !signingSecret) return null;
	return { clientId, clientSecret, signingSecret, redirectUri: redirectUri("slack") };
}

export function discordConfig() {
	const {
		DISCORD_APPLICATION_ID: clientId,
		DISCORD_CLIENT_SECRET: clientSecret,
		DISCORD_PUBLIC_KEY: publicKey,
		DISCORD_BOT_TOKEN: botToken,
	} = env;
	if (!clientId || !clientSecret || !publicKey || !botToken) return null;
	return { clientId, clientSecret, publicKey, redirectUri: redirectUri("discord") };
}

export function telegramConfig() {
	const {
		TELEGRAM_BOT_TOKEN: botToken,
		TELEGRAM_BOT_USERNAME: botUsername,
		TELEGRAM_WEBHOOK_SECRET: secret,
	} = env;
	if (!botToken || !botUsername || !secret) return null;
	return { botToken, botUsername, secret };
}

/** The tools linked by signing in to them. */
export function oauthProvider(name: string) {
	if (name === "slack") {
		const config = slackConfig();
		if (!config) return null;
		return {
			authorizeUrl: (state: string) => slackAuthorizeUrl({ ...config, state }),
			async link(userId: string, code: string) {
				const { token, ...identity } = await exchangeSlackCode({ ...config, code });
				const link = { ...identity, provider: "slack" as const, userId };
				await saveConnection(db, { ...link, tokenEncrypted: encryptConnectorToken(link, token) });
			},
		};
	}
	if (name === "discord") {
		const config = discordConfig();
		if (!config) return null;
		return {
			authorizeUrl: (state: string) => discordAuthorizeUrl({ ...config, state }),
			async link(userId: string, code: string) {
				const identity = await exchangeDiscordCode({ ...config, code });
				await saveConnection(db, { ...identity, provider: "discord", userId });
			},
		};
	}
	return null;
}
