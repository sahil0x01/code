"use server";

import {
	addMessage,
	cancelRun,
	createChat,
	deleteChat,
	getChatForUser,
	getProjectForUser,
	listRuns,
	markChatSeen,
	renameChat,
	requestStop,
	type SendResult,
} from "@nullfuse/db";
import { commandOptions } from "@nullfuse/agent/commands";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
	DEFAULT_REASONING,
	isModelId,
	isReasoningId,
	MAX_MESSAGE_LENGTH,
	MAX_TITLE_LENGTH,
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
const planOnly = z.boolean();
const reasoning = z.custom<ReasoningId>(isReasoningId).catch(DEFAULT_REASONING);

const startSchema = z.object({
	projectId: z.uuid(),
	baseBranch: z.string().trim().min(1).max(250),
	model,
	content,
	verify,
	planOnly,
	reasoning,
	issueNumber: z.coerce.number().int().positive().max(2_000_000_000).optional(),
});

const sendSchema = z.object({
	chatId: z.uuid(),
	model,
	content,
	verify,
	planOnly,
	reasoning,
});

const inputError: ChatState = {
	status: "error",
	message: `Write a message (up to ${MAX_MESSAGE_LENGTH.toLocaleString("en")} characters) and pick a model.`,
};

const missingTask: ChatState = { status: "error", message: "Say what to do after the command." };

// A typed command turns on the same option as its button.
function withCommands<T extends { content: string; planOnly: boolean; verify: boolean }>(input: T) {
	const typed = commandOptions(input.content);
	if (typed.missingTask) return null;
	return {
		...input,
		planOnly: input.planOnly || typed.planOnly,
		verify: input.verify || typed.verify,
	};
}

const failures = {
	not_found: "That project or chat was not found.",
	disconnected:
		"This project is disconnected from GitHub. Reconnect it to keep working.",
	queue_full:
		"You have too many unfinished runs. Wait for some to finish, then send again.",
	model_removed: "That model was removed. Pick another one, then send again.",
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
		planOnly: formData.get("planOnly") === "on",
		reasoning: formData.get("reasoning"),
		issueNumber: formData.get("issueNumber") ?? undefined,
	});
	if (!input.success) return inputError;
	const options = withCommands(input.data);
	if (!options) return missingTask;

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

		const result = await createChat(db, { userId: user.id, ...options });
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
		planOnly: formData.get("planOnly") === "on",
		reasoning: formData.get("reasoning"),
	});
	if (!input.success) return inputError;
	const options = withCommands(input.data);
	if (!options) return missingTask;

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

		const result = await addMessage(db, { userId: user.id, ...options });
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

export async function markSeen(input: { chatId: string; until: string }) {
	const { user } = await requireSession();
	const parsed = z.object({ chatId: z.uuid(), until: z.iso.datetime() }).safeParse(input);
	if (!parsed.success) return;

	await markChatSeen(db, user.id, parsed.data.chatId, new Date(parsed.data.until));
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

export async function retitleChat(_previous: ChatState, formData: FormData): Promise<ChatState> {
	const { user } = await requireSession();
	const input = z
		.object({ chatId: z.uuid(), title: z.string().trim().min(1).max(MAX_TITLE_LENGTH) })
		.safeParse({ chatId: formData.get("chatId"), title: formData.get("title") });
	if (!input.success) {
		return { status: "error", message: `Enter a name of 1 to ${MAX_TITLE_LENGTH} characters.` };
	}

	try {
		if (!(await renameChat(db, user.id, input.data.chatId, input.data.title))) {
			return { status: "error", message: "That chat was not found." };
		}
	} catch (error) {
		console.error("rename chat failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard", "layout");
	return { status: "success" };
}

/** Answers a plan with the go-ahead, using the same model and thinking level. */
export async function approvePlan(formData: FormData) {
	const { user } = await requireSession();
	const chatId = z.uuid().safeParse(formData.get("chatId"));
	if (!chatId.success) return;

	const latest = (await listRuns(db, user.id, chatId.data)).at(-1);
	if (!latest?.planOnly || latest.status !== "succeeded" || !isModelId(latest.model)) return;
	const sent = await addMessage(db, {
		userId: user.id,
		chatId: chatId.data,
		model: latest.model,
		reasoning: latest.reasoning,
		verify: latest.verify,
		content: "The plan is approved. Carry it out.",
	});
	if (sent.ok) await enqueueRun({ runId: sent.runId, chatId: sent.chatId });
	revalidatePath("/dashboard", "layout");
}
