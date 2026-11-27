import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { json, request } from "./http";

export function verifyTelegramSecret(given: string | null, secret: string) {
	if (!given) return false;
	const a = Buffer.from(given);
	const b = Buffer.from(secret);
	return a.length === b.length && timingSafeEqual(a, b);
}

const update = z.object({
	update_id: z.number(),
	message: z.object({
		message_id: z.number(),
		text: z.string(),
		chat: z.object({ id: z.number(), type: z.string() }),
		from: z.object({ id: z.number(), is_bot: z.boolean(), username: z.string().optional() }),
	}),
});

/**
 * Null unless a person wrote text to the bot: anything in a private chat, or a tag or
 * /prefill@bot in a group.
 */
export function parseTelegramUpdate(payload: unknown, botUsername: string) {
	const parsed = update.safeParse(payload);
	if (!parsed.success) return null;
	const { update_id, message } = parsed.data;
	const { type } = message.chat;
	const group = type === "group" || type === "supergroup";
	if (message.from.is_bot || (!group && type !== "private")) return null;

	const name = botUsername.replace(/[^\w]/g, "");
	const tag = new RegExp(`(^|\\s)(?:/prefill)?@${name}(?!\\w)`, "gi");
	const raw = message.text.trim();
	if (group && !tag.test(raw)) return null;
	const text = raw
		.replace(tag, "$1")
		.replace(/^\/prefill(?=\s|$)/i, "")
		.trim();
	// Account commands work only in private.
	const command = group ? null : /^\/(start|help|unlink)(?:\s+(\S+))?$/.exec(text);
	return {
		id: String(update_id),
		userId: String(message.from.id),
		username: message.from.username ?? null,
		chatId: String(message.chat.id),
		messageId: message.message_id,
		group,
		command: (command?.[1] ?? null) as "start" | "help" | "unlink" | null,
		argument: command?.[2] ?? null,
		text,
	};
}

export type TelegramMessage = NonNullable<ReturnType<typeof parseTelegramUpdate>>;

export function telegramLinkUrl(botUsername: string, code: string) {
	return `https://t.me/${botUsername.replace(/^@/, "")}?start=${code}`;
}

/** Sent as plain text, so nothing in it is read as formatting. */
export async function sendTelegramMessage(
	input: { botToken: string; chatId: string; text: string; replyTo?: number },
	fetcher: typeof fetch = fetch,
) {
	await request(
		"Telegram",
		`https://api.telegram.org/bot${input.botToken}/sendMessage`,
		json({
			chat_id: input.chatId,
			text: input.text,
			link_preview_options: { is_disabled: true },
			...(input.replyTo !== undefined && { reply_parameters: { message_id: input.replyTo } }),
		}),
		fetcher,
	);
}
