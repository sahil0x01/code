"use server";

import { endPreview, requestPreview, stopPreview } from "@nullfuse/db";
import { z } from "zod";
import { db } from "@/server/db";
import { enqueuePreview } from "@/server/preview";
import { requireSession } from "@/server/session";

const problems = {
	not_found: "That chat was not found.",
	not_set_up: "Set a start command and port on the project to use previews.",
	no_branch: "There is nothing to preview until the agent has run.",
	disconnected: "The project is disconnected from GitHub.",
} as const;

export type PreviewResult = { ok: true } | { ok: false; message: string };

export async function wakePreview(chatId: string): Promise<PreviewResult> {
	const { user } = await requireSession();
	if (!z.uuid().safeParse(chatId).success) return { ok: false, message: problems.not_found };

	const result = await requestPreview(db, user.id, chatId);
	if (!result.ok) return { ok: false, message: problems[result.reason] };
	if (result.start && !(await enqueuePreview({ chatId, generation: result.generation }))) {
		const message = "The preview could not be started. Try again.";
		await endPreview(db, chatId, result.generation, { status: "failed", error: message });
		return { ok: false, message };
	}
	return { ok: true };
}

export async function closePreview(chatId: string) {
	const { user } = await requireSession();
	if (z.uuid().safeParse(chatId).success) await stopPreview(db, user.id, chatId);
}
