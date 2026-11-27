"use server";

import { telegramLinkUrl } from "@nullfuse/connectors";
import { createLinkCode, removeConnection, setConnectionProject } from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { telegramConfig } from "@/server/connectors";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export type ConnectionState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

export async function chooseProject(_previous: ConnectionState, formData: FormData): Promise<ConnectionState> {
	const { user } = await requireSession();
	const input = z
		.object({ id: z.uuid(), projectId: z.uuid() })
		.safeParse({ id: formData.get("id"), projectId: formData.get("projectId") });
	if (!input.success) return { status: "error", message: "Choose a project." };

	try {
		if (!(await setConnectionProject(db, user.id, input.data.id, input.data.projectId))) {
			return { status: "error", message: "That project was not found." };
		}
	} catch (error) {
		console.error("choose project failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard/settings");
	return { status: "success" };
}

export async function disconnect(formData: FormData) {
	const { user } = await requireSession();
	const id = z.uuid().safeParse(formData.get("id"));
	if (!id.success) return;
	await removeConnection(db, user.id, id.data);
	revalidatePath("/dashboard/settings");
}

export type TelegramState = { status: "idle" } | { status: "ready"; url: string } | { status: "error"; message: string };

export async function startTelegramLink(): Promise<TelegramState> {
	const { user } = await requireSession();
	const config = telegramConfig();
	if (!config) return { status: "error", message: "Telegram is not set up." };
	try {
		const code = await createLinkCode(db, user.id, "telegram");
		return { status: "ready", url: telegramLinkUrl(config.botUsername, code) };
	} catch (error) {
		console.error("telegram link failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}
}
