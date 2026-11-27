import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ConnectorError, type Fetcher, json, request } from "./http";

// "commands" adds /prefill, "app_mentions:read" delivers tags, "chat:write" answers.
export const SLACK_SCOPES = ["commands", "app_mentions:read", "chat:write"];

const MAX_AGE_SECONDS = 5 * 60;

export function verifySlackSignature(input: {
	body: string;
	signature: string | null;
	timestamp: string | null;
	secret: string;
	now?: number;
}) {
	const { body, signature, timestamp, secret } = input;
	if (!signature?.startsWith("v0=") || !timestamp || !/^\d+$/.test(timestamp)) return false;
	// An old request is refused, so a captured one cannot be sent again later.
	const now = Math.floor((input.now ?? Date.now()) / 1000);
	if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;
	const expected = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest();
	const given = Buffer.from(signature.slice("v0=".length), "hex");
	return given.length === expected.length && timingSafeEqual(given, expected);
}

const command = z.object({
	team_id: z.string().min(1),
	user_id: z.string().min(1),
	trigger_id: z.string().min(1),
	text: z.string().default(""),
	// Replies are sent here, so it must be Slack's own address.
	response_url: z.url({ protocol: /^https$/, hostname: /^hooks\.slack\.com$/ }),
});

export type SlackCommand = z.infer<typeof command>;

/** Null when the body is not a slash command. */
export function parseSlackCommand(body: string) {
	const parsed = command.safeParse(Object.fromEntries(new URLSearchParams(body)));
	return parsed.success ? parsed.data : null;
}

const eventBody = z.discriminatedUnion("type", [
	z.object({ type: z.literal("url_verification"), challenge: z.string() }),
	z.object({
		type: z.literal("event_callback"),
		team_id: z.string().min(1),
		event_id: z.string().min(1),
		authorizations: z.array(z.object({ user_id: z.string() })).default([]),
		event: z.object({
			type: z.string(),
			user: z.string().optional(),
			bot_id: z.string().optional(),
			subtype: z.string().optional(),
			text: z.string().optional(),
			channel: z.string().optional(),
			thread_ts: z.string().optional(),
		}),
	}),
]);

/** What a message says, without the app's own tag and with links written out. */
function mentionText(text: string, botId: string | undefined) {
	const own = botId ? new RegExp(`<@${botId.replace(/\W/g, "")}(\\|[^>]*)?>`, "g") : /^\s*<@[^>]+>/;
	return unescapeSlack(
		text
			.replace(own, "")
			.replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
			.replace(/<(https?:[^>]+|mailto:[^|>]+)>/g, "$1")
			.replace(/<#[^|>]+\|([^>]*)>/g, "#$1"),
	).trim();
}

/** The address check Slack makes, or a person tagging the app. Null for anything else. */
export function parseSlackEvent(body: string) {
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		return null;
	}
	const parsed = eventBody.safeParse(payload);
	if (!parsed.success) return null;
	if (parsed.data.type === "url_verification") {
		return { kind: "verify" as const, challenge: parsed.data.challenge };
	}
	const { team_id, event_id, authorizations, event } = parsed.data;
	// Bots are ignored, so apps cannot keep tagging each other.
	if (event.type !== "app_mention" || event.bot_id || event.subtype || !event.user || !event.channel) return null;
	return {
		kind: "mention" as const,
		id: event_id,
		workspaceId: team_id,
		userId: event.user,
		channel: event.channel,
		threadTs: event.thread_ts,
		text: mentionText(event.text ?? "", authorizations[0]?.user_id),
	};
}

export type SlackMention = Extract<NonNullable<ReturnType<typeof parseSlackEvent>>, { kind: "mention" }>;

/** Slack sends typed &, < and > as entities. */
export function unescapeSlack(text: string) {
	return text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** Stops text from becoming mentions or disguised links. */
export function escapeSlack(text: string) {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function slackAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
	const url = new URL("https://slack.com/oauth/v2/authorize");
	url.search = new URLSearchParams({
		client_id: input.clientId,
		scope: SLACK_SCOPES.join(","),
		redirect_uri: input.redirectUri,
		state: input.state,
	}).toString();
	return url.toString();
}

const installed = z.object({
	access_token: z.string().min(1),
	team: z.object({ id: z.string().min(1), name: z.string() }),
	authed_user: z.object({ id: z.string().min(1) }),
});

async function call(fetcher: Fetcher, method: string, init: RequestInit) {
	// Slack answers 200 even when it refuses.
	const data = (await request("Slack", `https://slack.com/api/${method}`, init, fetcher)) as {
		ok?: boolean;
		error?: string;
	};
	if (!data.ok) throw new ConnectorError("Slack", data.error ?? "unknown");
	return data;
}

/** Trades the sign-in code for the workspace's token and the ID of the person who signed in. */
export async function exchangeSlackCode(
	input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
	fetcher: typeof fetch = fetch,
) {
	const data = await call(fetcher, "oauth.v2.access", {
		method: "POST",
		body: new URLSearchParams({
			client_id: input.clientId,
			client_secret: input.clientSecret,
			code: input.code,
			redirect_uri: input.redirectUri,
		}),
	});
	const { access_token, team, authed_user } = installed.parse(data);
	return { token: access_token, workspaceId: team.id, workspaceName: team.name, externalUserId: authed_user.id };
}

/** A user ID as the channel sends a direct message from the app. */
export async function postSlackMessage(
	input: { token: string; channel: string; text: string },
	fetcher: typeof fetch = fetch,
) {
	await call(
		fetcher,
		"chat.postMessage",
		json(
			{ channel: input.channel, text: input.text, unfurl_links: false },
			{ authorization: `Bearer ${input.token}` },
		),
	);
}

/** A message in the channel that only one person can see. */
export async function postSlackEphemeral(
	input: { token: string; channel: string; userId: string; text: string; threadTs?: string },
	fetcher: typeof fetch = fetch,
) {
	await call(
		fetcher,
		"chat.postEphemeral",
		json(
			{ channel: input.channel, user: input.userId, text: input.text, thread_ts: input.threadTs },
			{ authorization: `Bearer ${input.token}` },
		),
	);
}

/** The reply only the person who ran the command can see. */
export async function replyToSlackCommand(url: string, text: string, fetcher: typeof fetch = fetch) {
	// The answer here is the word "ok", not JSON; only the status matters.
	await request("Slack", url, json({ response_type: "ephemeral", text }), fetcher);
}
