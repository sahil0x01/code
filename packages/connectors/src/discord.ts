import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { json, request } from "./http";

const API = "https://discord.com/api/v10";
const MAX_AGE_SECONDS = 5 * 60;
// The fixed header that turns a raw Ed25519 key into one Node can read.
const KEY_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const DISCORD_PING = 1;
export const DISCORD_COMMAND = 2;
export const DISCORD_PONG = { type: 1 };
/** "Thinking...", visible only to the person, to be replaced within 15 minutes. */
export const DISCORD_DEFERRED = { type: 5, data: { flags: 64 } };

export function verifyDiscordSignature(input: {
	body: string;
	signature: string | null;
	timestamp: string | null;
	publicKey: string;
	now?: number;
}) {
	const { body, signature, timestamp, publicKey } = input;
	if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
	const now = Math.floor((input.now ?? Date.now()) / 1000);
	if (Math.abs(now - Number(timestamp)) > MAX_AGE_SECONDS) return false;
	const raw = Buffer.from(publicKey, "hex");
	if (raw.length !== 32) return false;
	const key = createPublicKey({ key: Buffer.concat([KEY_PREFIX, raw]), format: "der", type: "spki" });
	return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
}

const person = z.object({ id: z.string().min(1) });

const interaction = z.object({
	type: z.number(),
	id: z.string().min(1),
	application_id: z.string().regex(/^\d+$/),
	token: z.string().regex(/^[\w.-]+$/),
	data: z
		.object({
			name: z.string(),
			options: z.array(z.object({ name: z.string(), value: z.unknown() })).optional(),
		})
		.optional(),
	// A command in a server names the member; in a direct message, the user.
	member: z.object({ user: person }).optional(),
	user: person.optional(),
});

/** Null when the body is not an interaction we understand. */
export function parseDiscordInteraction(body: string) {
	let payload: unknown;
	try {
		payload = JSON.parse(body);
	} catch {
		return null;
	}
	const parsed = interaction.safeParse(payload);
	if (!parsed.success) return null;
	const { data, member, user, ...rest } = parsed.data;
	const task = data?.options?.find((option) => option.name === "task")?.value;
	return {
		...rest,
		command: data?.name ?? null,
		task: typeof task === "string" ? task : "",
		userId: member?.user.id ?? user?.id ?? null,
	};
}

export type DiscordInteraction = NonNullable<ReturnType<typeof parseDiscordInteraction>>;

/** Stops the agent's text from becoming mentions or formatting that hides links. */
export function escapeDiscord(text: string) {
	return text.replace(/([\\[\]()*_~`|])/g, "\\$1");
}

const noMentions = { allowed_mentions: { parse: [] } };

export async function editDiscordReply(
	input: { applicationId: string; token: string; text: string },
	fetcher: typeof fetch = fetch,
) {
	await request(
		"Discord",
		`${API}/webhooks/${input.applicationId}/${input.token}/messages/@original`,
		{ ...json({ content: input.text, ...noMentions }), method: "PATCH" },
		fetcher,
	);
}

export async function sendDiscordMessage(
	input: { botToken: string; userId: string; text: string },
	fetcher: typeof fetch = fetch,
) {
	const authorization = { authorization: `Bot ${input.botToken}` };
	const channel = z
		.object({ id: z.string().regex(/^\d+$/) })
		.parse(
			await request(
				"Discord",
				`${API}/users/@me/channels`,
				json({ recipient_id: input.userId }, authorization),
				fetcher,
			),
		);
	await request(
		"Discord",
		`${API}/channels/${channel.id}/messages`,
		// 4 hides link previews.
		json({ content: input.text, flags: 4, ...noMentions }, authorization),
		fetcher,
	);
}

export function discordAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }) {
	const url = new URL("https://discord.com/oauth2/authorize");
	url.search = new URLSearchParams({
		client_id: input.clientId,
		response_type: "code",
		scope: "identify",
		redirect_uri: input.redirectUri,
		state: input.state,
	}).toString();
	return url.toString();
}

/** Who signed in. The token is only used for this and is not kept. */
export async function exchangeDiscordCode(
	input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
	fetcher: typeof fetch = fetch,
) {
	const { access_token } = z.object({ access_token: z.string().min(1) }).parse(
		await request(
			"Discord",
			`${API}/oauth2/token`,
			{
				method: "POST",
				body: new URLSearchParams({
					client_id: input.clientId,
					client_secret: input.clientSecret,
					grant_type: "authorization_code",
					code: input.code,
					redirect_uri: input.redirectUri,
				}),
			},
			fetcher,
		),
	);
	const me = z.object({ id: z.string().min(1), username: z.string() }).parse(
		await request("Discord", `${API}/users/@me`, { headers: { authorization: `Bearer ${access_token}` } }, fetcher),
	);
	return { workspaceId: "discord", workspaceName: me.username, externalUserId: me.id };
}
