"use server";

import { addMessage, getChatForUser, listRuns } from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isModelId } from "@/lib/chat";
import { getInstallationOctokit } from "@/lib/github-app";
import { failureReport, mergePull } from "@/lib/pr-source";
import { db } from "@/server/db";
import { enqueueRun } from "@/server/enqueue";
import { requireSession } from "@/server/session";

export type PullActionResult = { ok: true } | { ok: false; message: string };

const failed = (message: string): PullActionResult => ({ ok: false, message });
const retry = "Something went wrong. Try again.";

async function ownedPull(userId: string, chatId: string) {
	const chat = await getChatForUser(db, userId, chatId);
	if (!chat || chat.installationId === null || chat.pullRequestNumber === null) return null;
	const octokit = await getInstallationOctokit(chat.installationId);
	return { chat, number: chat.pullRequestNumber, client: octokit.rest };
}

const mergeInput = z.object({ chatId: z.uuid(), sha: z.string().regex(/^[0-9a-f]{40}$/) });

export async function mergePullRequest(input: z.input<typeof mergeInput>): Promise<PullActionResult> {
	const { user } = await requireSession();
	const parsed = mergeInput.safeParse(input);
	if (!parsed.success) return failed(retry);

	try {
		const pull = await ownedPull(user.id, parsed.data.chatId);
		if (!pull) return failed("That pull request was not found.");
		const runs = await listRuns(db, user.id, pull.chat.id);
		if (runs.some((run) => run.status === "queued" || run.status === "running")) {
			return failed("The agent is still working in this chat. Wait or stop it, then merge.");
		}
		const result = await mergePull(pull.client, pull.chat.projectName, pull.number, parsed.data.sha);
		if (!result.ok) return result;
	} catch (error) {
		console.error("merge pull request failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}

const fixInput = z.object({
	chatId: z.uuid(),
	checkRunId: z.number().int().positive(),
	model: z.string().refine(isModelId),
});

export async function fixCheck(input: z.input<typeof fixInput>): Promise<PullActionResult> {
	const { user } = await requireSession();
	const parsed = fixInput.safeParse(input);
	if (!parsed.success) return failed(retry);
	const { chatId, checkRunId, model } = parsed.data;

	try {
		const pull = await ownedPull(user.id, chatId);
		if (!pull) return failed("That pull request was not found.");
		const content = await failureReport(pull.client, pull.chat.projectName, pull.number, checkRunId);
		if (!content) return failed("That check is no longer failing on the latest commit.");

		const sent = await addMessage(db, { userId: user.id, chatId, model, content, verify: false });
		if (!sent.ok) {
			return failed(
				sent.reason === "queue_full" ? "You have too many unfinished runs." : "The message could not be sent.",
			);
		}
		await enqueueRun({ runId: sent.runId, chatId: sent.chatId });
	} catch (error) {
		console.error("fix check failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}
