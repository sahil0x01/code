"use server";

import {
	addMessage,
	cancelRun,
	createChat,
	deleteChat,
	getChatForUser,
	getProjectForUser,
	requestStop,
	type SendResult,
} from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
	DEFAULT_REASONING,
	isModelId,
	isReasoningId,
	MAX_MESSAGE_LENGTH,
	type ReasoningId,
} from "@/lib/chat";
import { db } from "@/server/db";
import { enqueueRun } from "@/server/enqueue";
import { checkRepo } from "@/server/github-checks";
import { requireSession } from "@/server/session";

export type ChatState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

const content = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);
const model = z.string().refine(isModelId);

const verify = z.boolean();
const record = z.boolean();
const reasoning = z.custom<ReasoningId>(isReasoningId).catch(DEFAULT_REASONING);

const startSchema = z.object({
	projectId: z.uuid(),
	baseBranch: z.string().trim().min(1).max(250),
	model,
	content,
	verify,
	record,
	reasoning,
});

const sendSchema = z.object({
	chatId: z.uuid(),
	model,
	content,
	verify,
	record,
	reasoning,
});

const inputError: ChatState = {
	status: "error",
	message: `Write a message (up to ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters) and pick a model.`,
};

const failures = {
	not_found: "That project or chat was not found.",
	disconnected:
		"This project is disconnected from GitHub. Reconnect it to keep working.",
	queue_full:
		"You have too many unfinished runs. Wait for some to finish, then send again.",
} as const;

function failure(
	reason: Extract<SendResult, { ok: false }>["reason"],
): ChatState {
	return { status: "error", message: failures[reason] };
}

export async function startChat(
	_previous: ChatState,
	formData: FormData,
): Promise<ChatState> {
	const { user } = await requireSession();

	const input = startSchema.safeParse({
		projectId: formData.get("projectId"),
		baseBranch: formData.get("baseBranch"),
		model: formData.get("model"),
		content: formData.get("content"),
		verify: formData.get("verify") === "on",
		record: formData.get("record") === "on",
		reasoning: formData.get("reasoning"),
	});
	if (!input.success) return inputError;

	let chatId: string;
	try {
		const project = await getProjectForUser(db, user.id, input.data.projectId);
		if (!project) return failure("not_found");
		if (project.installationId === null) return failure("disconnected");

		const repo = await checkRepo(
			project.installationId,
			project.fullName,
			input.data.baseBranch,
		);
		if (repo === "no_repo") {
			return {
				status: "error",
				message: "The app can't read this repository any more.",
			};
		}
		if (repo === "no_branch") {
			return {
				status: "error",
				message: `The branch "${input.data.baseBranch}" doesn't exist on GitHub.`,
			};
		}

		const result = await createChat(db, { userId: user.id, ...input.data });
		if (!result.ok) return failure(result.reason);
		chatId = result.chatId;
		await enqueueRun({ runId: result.runId, chatId });
	} catch (error) {
		console.error("start chat failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard", "layout");
	redirect(`/dashboard/chats/${chatId}`);
}

export async function sendMessage(
	_previous: ChatState,
	formData: FormData,
): Promise<ChatState> {
	const { user } = await requireSession();

	const input = sendSchema.safeParse({
		chatId: formData.get("chatId"),
		model: formData.get("model"),
		content: formData.get("content"),
		verify: formData.get("verify") === "on",
		record: formData.get("record") === "on",
		reasoning: formData.get("reasoning"),
	});
	if (!input.success) return inputError;

	try {
		const chat = await getChatForUser(db, user.id, input.data.chatId);
		if (!chat) return failure("not_found");
		if (chat.installationId === null) return failure("disconnected");

		const repo = await checkRepo(chat.installationId, chat.projectName);
		if (repo !== "ok") {
			return {
				status: "error",
				message: "The app can't read this repository any more.",
			};
		}

		const result = await addMessage(db, { userId: user.id, ...input.data });
		if (!result.ok) return failure(result.reason);
		await enqueueRun({ runId: result.runId, chatId: result.chatId });
	} catch (error) {
		console.error("send message failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard", "layout");
	return { status: "success" };
}

// A queued run is cancelled outright; a running one is asked to stop, and the
// worker notices within a second.
export async function stopRun(formData: FormData) {
	const { user } = await requireSession();

	const input = z
		.object({ runId: z.uuid() })
		.safeParse({ runId: formData.get("runId") });
	if (!input.success) return;

	const cancelled = await cancelRun(db, user.id, input.data.runId);
	if (!cancelled) await requestStop(db, user.id, input.data.runId);

	revalidatePath("/dashboard", "layout");
}

export async function removeChat(
	_previous: ChatState,
	formData: FormData,
): Promise<ChatState> {
	const { user } = await requireSession();

	const input = z
		.object({ chatId: z.uuid() })
		.safeParse({ chatId: formData.get("chatId") });
	if (!input.success) {
		return { status: "error", message: "That chat was not found." };
	}

	try {
		const result = await deleteChat(db, user.id, input.data.chatId);
		if (!result.ok) {
			return {
				status: "error",
				message:
					result.reason === "running"
						? "A run is still working in this chat. Stop it first."
						: "That chat was not found.",
			};
		}
	} catch (error) {
		console.error("delete chat failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard", "layout");
	redirect("/dashboard/chats");
}
