import {
	escapeSlack,
	parseSlackCommand,
	replyToSlackCommand,
	type SlackCommand,
	unescapeSlack,
	verifySlackSignature,
} from "@nullfuse/connectors";
import { after } from "next/server";
import { env } from "@/env";
import { taskReply } from "@/lib/connector-reply";
import { runConnectorTask, TASK_FAILED, taskProblem } from "@/server/connector-task";
import { slackConfig } from "@/server/connectors";

const ephemeral = (text: string) => Response.json({ response_type: "ephemeral", text });

async function start(command: SlackCommand, content: string) {
	const result = await runConnectorTask({
		provider: "slack",
		workspaceId: command.team_id,
		externalUserId: command.user_id,
		externalId: command.trigger_id,
		content,
	});
	const text = result ? taskReply(result, env.NEXT_PUBLIC_APP_URL, escapeSlack) : TASK_FAILED;
	await replyToSlackCommand(command.response_url, text).catch((error) => console.error("slack reply failed", error));
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

	const command = parseSlackCommand(body);
	if (!command) return new Response("Bad payload", { status: 400 });

	const content = unescapeSlack(command.text).trim();
	if (!content || content === "help") {
		return ephemeral("Say what to do, for example: `/prefill fix the broken link in the footer`");
	}
	const problem = taskProblem(content);
	if (problem) return ephemeral(problem);

	// Slack waits three seconds, so the work happens after this answer.
	after(() => start(command, content));
	return ephemeral("Got it. Starting...");
}
