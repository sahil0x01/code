import "server-only";
import { escapeGitHub, type GitHubMention, issueTask, mentionAccess } from "@nullfuse/connectors";
import {
	findChatByPullRequest,
	findConnectedProject,
	findUserIdByGithubId,
	saveConnection,
} from "@nullfuse/db";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat";
import { taskReply } from "@/lib/connector-reply";
import { env } from "@/env";
import { getInstallationOctokit } from "@/lib/github-app";
import { runConnectorTask, TASK_FAILED, taskProblem } from "@/server/connector-task";
import { db } from "@/server/db";
import { canWrite } from "@/server/github-checks";

async function reply(mention: GitHubMention, body: string) {
	const [owner = "", repo = ""] = mention.repository.fullName.split("/");
	const octokit = await getInstallationOctokit(mention.installationId);
	await octokit.rest.issues.createComment({ owner, repo, issue_number: mention.issue.number, body });
}

/** Marks the mention as seen, so the thread does not fill with "started" messages. */
async function acknowledge(mention: GitHubMention) {
	const [owner = "", repo = ""] = mention.repository.fullName.split("/");
	const { reactions } = (await getInstallationOctokit(mention.installationId)).rest;
	if (mention.source === "issue") {
		await reactions.createForIssue({ owner, repo, issue_number: mention.issue.number, content: "eyes" });
	} else {
		await reactions.createForIssueComment({ owner, repo, comment_id: Number(mention.id), content: "eyes" });
	}
}

export async function handleMention(mention: GitHubMention) {
	// Only a signed-up person with this repository connected can start a run. Others are ignored.
	const userId = await findUserIdByGithubId(db, mention.sender.id);
	if (!userId) return;
	const project = await findConnectedProject(db, userId, mention.installationId, mention.repository.id);
	if (!project) return;

	const access = await mentionAccess(mention, (login) =>
		canWrite(mention.installationId, mention.repository.fullName, login),
	);
	if (!access.allowed) return reply(mention, "You need write access to this repository to give me tasks.");

	const { issue } = mention;
	let chatId: string | undefined;
	if (issue.isPullRequest) {
		chatId = (await findChatByPullRequest(db, userId, project.id, issue.number)) ?? undefined;
		if (!chatId) return reply(mention, "I can only continue pull requests that your chats opened.");
		if (!mention.task) return reply(mention, "Say what to change after the mention.");
	}

	const written = chatId ? mention.task : issueTask(mention, access.readable);
	if (written === null) {
		return reply(
			mention,
			"Say what to do in a comment. This issue's author can't write to the repository, so its text is not given to the agent.",
		);
	}
	const content = written.slice(0, MAX_MESSAGE_LENGTH);
	const problem = taskProblem(content);
	if (problem) return reply(mention, problem);

	const identity = {
		provider: "github" as const,
		workspaceId: String(mention.repository.id),
		externalUserId: String(mention.sender.id),
	};
	// Signing in with GitHub already proved the account, so there is nothing to connect first.
	await saveConnection(db, { ...identity, userId, workspaceName: project.fullName, projectId: project.id });
	const result = await runConnectorTask({
		...identity,
		externalId: mention.id,
		content,
		chatId,
		issueNumber: chatId ? undefined : issue.number,
		target: String(issue.number),
	});

	if (result?.ok) return acknowledge(mention);
	if (result?.reason === "duplicate") return;
	return reply(mention, result ? taskReply(result, env.NEXT_PUBLIC_APP_URL, escapeGitHub) : TASK_FAILED);
}
