import {
	DISCORD_COMMAND,
	DISCORD_DEFERRED,
	DISCORD_PING,
	DISCORD_PONG,
	type DiscordInteraction,
	editDiscordReply,
	escapeDiscord,
	parseDiscordInteraction,
	verifyDiscordSignature,
} from "@nullfuse/connectors";
import { after } from "next/server";
import { env } from "@/env";
import { taskReply } from "@/lib/connector-reply";
import { runConnectorTask, TASK_FAILED, taskProblem } from "@/server/connector-task";
import { discordConfig } from "@/server/connectors";

async function start(interaction: DiscordInteraction, userId: string) {
	const content = interaction.task.trim();
	let text = content ? taskProblem(content) : "Say what to do.";
	if (!text) {
		const result = await runConnectorTask({
			provider: "discord",
			workspaceId: "discord",
			externalUserId: userId,
			externalId: interaction.id,
			content,
		});
		text = result ? taskReply(result, env.NEXT_PUBLIC_APP_URL, escapeDiscord) : TASK_FAILED;
	}
	await editDiscordReply({ applicationId: interaction.application_id, token: interaction.token, text }).catch(
		(error) => console.error("discord reply failed", error),
	);
}

export async function POST(request: Request) {
	const config = discordConfig();
	if (!config) return new Response("Discord is not set up", { status: 404 });

	const body = await request.text();
	const signed = verifyDiscordSignature({
		body,
		signature: request.headers.get("x-signature-ed25519"),
		timestamp: request.headers.get("x-signature-timestamp"),
		publicKey: config.publicKey,
	});
	if (!signed) return new Response("Invalid signature", { status: 401 });

	const interaction = parseDiscordInteraction(body);
	if (!interaction) return new Response("Bad payload", { status: 400 });
	if (interaction.type === DISCORD_PING) return Response.json(DISCORD_PONG);

	const { userId } = interaction;
	if (interaction.type !== DISCORD_COMMAND || interaction.command !== "prefill" || !userId) {
		return new Response("Unknown command", { status: 400 });
	}
	after(() => start(interaction, userId));
	return Response.json(DISCORD_DEFERRED);
}
