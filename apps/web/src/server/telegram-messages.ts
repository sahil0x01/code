import "server-only";
import type { TelegramMessage } from "@nullfuse/connectors";
import { redeemLinkCode, removeConnectionByIdentity, saveConnection } from "@nullfuse/db";
import { env } from "@/env";
import { taskReply } from "@/lib/connector-reply";
import { runConnectorTask, TASK_FAILED, taskProblem } from "@/server/connector-task";
import { db } from "@/server/db";

const HELP =
	"Send me a task, for example: fix the broken link in the footer\nIn a group, tag me with the task.\n/unlink removes this link.";

/** The bot's answer to one message, or null when it should say nothing. */
export async function answerTelegram(message: TelegramMessage) {
	const identity = { provider: "telegram" as const, workspaceId: "telegram", externalUserId: message.userId };

	if (message.command === "start" && message.argument) {
		const owner = await redeemLinkCode(db, "telegram", message.argument);
		if (!owner) return "That link has expired. Make a new one under Settings.";
		await saveConnection(db, {
			...identity,
			userId: owner.userId,
			workspaceName: message.username ? `@${message.username}` : "Telegram",
		});
		// Named, so someone sent another person's link can see it and undo it.
		return `Linked to the Prefill account "${owner.name}". If that isn't you, send /unlink now.\n\n${HELP}`;
	}
	if (message.command === "unlink") {
		return (await removeConnectionByIdentity(db, identity)) ? "Unlinked." : "This account wasn't linked.";
	}
	if (message.command) return HELP;

	const problem = taskProblem(message.text);
	if (problem) return problem;
	const result = await runConnectorTask({ ...identity, externalId: message.id, content: message.text });
	if (!result) return TASK_FAILED;
	if (!result.ok && result.reason === "duplicate") return null;
	// Others can read a group, so the project is not named there.
	if (result.ok && message.group) return "Started. I'll message you privately when it finishes.";
	return taskReply(result, env.NEXT_PUBLIC_APP_URL);
}
