import { z } from "zod";
import type { PullResponse } from "./pr";

type Chat = { pullRequestNumber: number | null; projectName: string; installationId: number | null };

export type PullDeps = {
	getChat(userId: string, chatId: string): Promise<Chat | null>;
	loadPull(installationId: number, fullName: string, number: number): Promise<PullResponse>;
};

function json(body: PullResponse | { error: string }, status = 200) {
	return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handlePull(
	deps: PullDeps,
	input: { userId: string | undefined; chatId: string },
) {
	if (!input.userId) return json({ error: "Sign in again to see the pull request." }, 401);

	const notFound = () => json({ error: "That chat was not found." }, 404);
	if (!z.uuid().safeParse(input.chatId).success) return notFound();
	const chat = await deps.getChat(input.userId, input.chatId);
	if (!chat) return notFound();

	if (chat.installationId === null) return json({ state: "disconnected" });
	if (chat.pullRequestNumber === null) return json({ state: "none" });

	try {
		return json(
			await deps.loadPull(chat.installationId, chat.projectName, chat.pullRequestNumber),
		);
	} catch (error) {
		console.error("load pull request failed", error);
		return json({ error: "GitHub didn't return the pull request. Try again." }, 502);
	}
}
