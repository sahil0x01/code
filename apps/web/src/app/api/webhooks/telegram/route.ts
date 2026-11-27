import { parseTelegramUpdate, sendTelegramMessage, verifyTelegramSecret } from "@nullfuse/connectors";
import { after } from "next/server";
import { telegramConfig } from "@/server/connectors";
import { answerTelegram } from "@/server/telegram-messages";

export async function POST(request: Request) {
	const config = telegramConfig();
	if (!config) return new Response("Telegram is not set up", { status: 404 });
	if (!verifyTelegramSecret(request.headers.get("x-telegram-bot-api-secret-token"), config.secret)) {
		return new Response("Invalid secret", { status: 401 });
	}

	const message = parseTelegramUpdate(await request.json().catch(() => null), config.botUsername);
	// Anything else is accepted, or Telegram would keep sending it.
	if (message) {
		after(async () => {
			try {
				const text = await answerTelegram(message);
				if (!text) return;
				await sendTelegramMessage({
					botToken: config.botToken,
					chatId: message.chatId,
					replyTo: message.group ? message.messageId : undefined,
					text,
				});
			} catch (error) {
				console.error("telegram message failed", error);
			}
		});
	}
	return new Response(null, { status: 200 });
}
