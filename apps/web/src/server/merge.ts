import "server-only";
import { loadPull, stepMerge } from "@nullfuse/connectors/pulls";
import { getChatForUser, requestMerge } from "@nullfuse/db";
import { getInstallationOctokit } from "@/lib/github-app";
import { db } from "@/server/db";
import { enqueueRun } from "@/server/enqueue";

export type MergeStart = { ok: true } | { ok: false; message: string };

const github = async (installationId: number) => (await getInstallationOctokit(installationId)).rest;

/** Starts a merge for the Merge button or `/merge`. Without `sha`, the latest commit is approved. */
export async function startMergeFor(userId: string, chatId: string, sha?: string): Promise<MergeStart> {
	const chat = await getChatForUser(db, userId, chatId);
	if (!chat || chat.installationId === null || chat.pullRequestNumber === null) {
		return { ok: false, message: "This chat has no pull request to merge." };
	}
	let approved = sha;
	if (!approved) {
		const pull = await loadPull(await github(chat.installationId), chat.projectName, chat.pullRequestNumber);
		if (pull.state !== "ok" || pull.status !== "open") return { ok: false, message: "The pull request is not open." };
		approved = pull.headSha;
	}
	if (!(await requestMerge(db, userId, chatId, approved))) {
		return { ok: false, message: "The agent is still working in this chat. Wait or stop it, then merge." };
	}
	// The request is saved, so if this first step fails the worker's next pass takes it.
	await stepMerge({ db, github, enqueue: enqueueRun }, chatId).catch((error) =>
		console.error("merge step failed", error),
	);
	return { ok: true };
}
