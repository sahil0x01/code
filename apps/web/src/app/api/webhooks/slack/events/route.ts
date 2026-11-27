import {
	escapeSlack,
	parseSlackEvent,
	postSlackEphemeral,
	type SlackMention,
	verifySlackSignature,
} from "@nullfuse/connectors";
import { findWorkspaceToken } from "@nullfuse/db";
import { after } from "next/server";
import { env } from "@/env";
import { taskReply } from "@/lib/connector-reply";
import { runConnectorTask, TASK_FAILED, taskProblem } from "@/server/connector-task";
import { slackConfig } from "@/server/connectors";
import { db } from "@/server/db";
import { decryptConnectorToken } from "@/server/secrets";

async function start(mention: SlackMention) {
	let text = mention.text ? taskProblem(mention.text) : "Tag me and say what to do.";
	if (!text) {
		const result = await runConnectorTask({
			provider: "slack",
			workspaceId: mention.workspaceId,
			externalUserId: mention.userId,
			externalId: mention.id,
			content: mention.text,
		});
		if (result && !result.ok && result.reason === "duplicate") return;
		text = result ? taskReply(result, env.NEXT_PUBLIC_APP_URL, escapeSlack) : TASK_FAILED;
	}
	const workspace = await findWorkspaceToken(db, "slack", mention.workspaceId);
	if (!workspace) return;
	await postSlackEphemeral({
		token: decryptConnectorToken(workspace, workspace.tokenEncrypted),
		channel: mention.channel,
		userId: mention.userId,
		threadTs: mention.threadTs,
		text,
	});
}

export async function POST(request: Request) {
	const config = slackConfig();
	if (!config) return new Response("Slack is not set up", { status: 404 });

	const body = await request.text();
	const signed = verifySlackSignature({
		body,
		signature: request.headers.get("x-slack-signature"),
		timestamp: request.headers.get("x-slack-request-timestamp"),
		secret: config.signingSecret,
	});
	if (!signed) return new Response("Invalid signature", { status: 401 });

	const event = parseSlackEvent(body);
	if (event?.kind === "verify") return Response.json({ challenge: event.challenge });
	// Anything else is accepted, or Slack would keep sending it.
	if (event) after(() => start(event).catch((error) => console.error("slack mention failed", error)));
	return new Response(null, { status: 200 });
}
