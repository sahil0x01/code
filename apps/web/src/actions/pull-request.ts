"use server";

import { addMessage, cancelMerge, getChatForUser, listRuns, setChatDone } from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isModelId } from "@/lib/chat";
import { listPullComments } from "@/lib/comment-source";
import { commentsMessage } from "@/lib/comments";
import { getInstallationOctokit } from "@/lib/github-app";
import { failureReport, mergePull } from "@nullfuse/connectors/pulls";
import { db } from "@/server/db";
import { enqueueRun } from "@/server/enqueue";
import { startMergeFor } from "@/server/merge";
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
		// The merge already happened, so a failure here must not report it as failed.
		await setChatDone(db, user.id, pull.chat.id, true).catch((error) =>
			console.error("mark chat done failed", error),
		);
		await cancelMerge(db, user.id, pull.chat.id).catch((error) => console.error("clear merge failed", error));
	} catch (error) {
		console.error("merge pull request failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}

function notSent(reason: string) {
	if (reason === "queue_full") return "You have too many unfinished runs.";
	if (reason === "model_removed") return "That model was removed. Pick another one in the message box.";
	return "The message could not be sent.";
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
			return failed(notSent(sent.reason));
		}
		await enqueueRun({ runId: sent.runId, chatId: sent.chatId });
	} catch (error) {
		console.error("fix check failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}

const commentsInput = z.object({
	chatId: z.uuid(),
	model: z.string().refine(isModelId),
	picked: z.array(z.object({ key: z.string().max(40), updatedAt: z.string().max(40) })).min(1).max(30),
});

/** Sends comments the user chose to the agent, as one follow-up. */
export async function sendComments(input: z.input<typeof commentsInput>): Promise<PullActionResult> {
	const { user } = await requireSession();
	const parsed = commentsInput.safeParse(input);
	if (!parsed.success) return failed(retry);
	const { chatId, model, picked } = parsed.data;

	try {
		const pull = await ownedPull(user.id, chatId);
		if (!pull) return failed("That pull request was not found.");
		const all = await listPullComments(pull.client, pull.chat.projectName, pull.number);
		// Only the text the user saw is sent: an edit since then has to be read first.
		const chosen = all.filter((comment) =>
			picked.some((p) => p.key === comment.key && p.updatedAt === comment.updatedAt),
		);
		if (chosen.length !== picked.length) {
			return failed("A comment changed since you looked. Read the comments again, then send.");
		}
		const sent = await addMessage(db, {
			userId: user.id,
			chatId,
			model,
			content: commentsMessage(chosen),
			verify: false,
		});
		if (!sent.ok) {
			return failed(notSent(sent.reason));
		}
		await enqueueRun({ runId: sent.runId, chatId: sent.chatId });
	} catch (error) {
		console.error("send comments failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}

/** Merges once the commit is ready, fixing conflicts and failed checks on the way. */
export async function startMerge(input: z.input<typeof mergeInput>): Promise<PullActionResult> {
	const { user } = await requireSession();
	const parsed = mergeInput.safeParse(input);
	if (!parsed.success) return failed(retry);

	let result: PullActionResult;
	try {
		result = await startMergeFor(user.id, parsed.data.chatId, parsed.data.sha);
	} catch (error) {
		console.error("start merge failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return result;
}

export async function stopMerge(input: { chatId: string }): Promise<PullActionResult> {
	const { user } = await requireSession();
	const parsed = z.object({ chatId: z.uuid() }).safeParse(input);
	if (!parsed.success) return failed(retry);

	try {
		await cancelMerge(db, user.id, parsed.data.chatId);
	} catch (error) {
		console.error("cancel merge failed", error);
		return failed(retry);
	}

	revalidatePath("/dashboard", "layout");
	return { ok: true };
}
