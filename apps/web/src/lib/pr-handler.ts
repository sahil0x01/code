import { z } from "zod";
import type { PullResponse } from "@nullfuse/connectors/pulls/status";

type Chat = { pullRequestNumber: number | null; projectName: string; installationId: number | null };

export type PullDeps = {
	getChat(userId: string, chatId: string): Promise<Chat | null>;
	loadPull(installationId: number, fullName: string, number: number): Promise<PullResponse>;
	/** Called when the pull request turns out to be merged, here or on GitHub. */
	merged(userId: string, chatId: string): Promise<void>;
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
		const pull = await deps.loadPull(chat.installationId, chat.projectName, chat.pullRequestNumber);
		if (pull.state === "ok" && pull.status === "merged") {
			// Showing the pull request matters more than the mark, which is retried on the next load.
			await deps.merged(input.userId, input.chatId).catch((error) => console.error("mark merged failed", error));
		}
		return json(pull);
	} catch (error) {
		console.error("load pull request failed", error);
		return json({ error: "GitHub didn't return the pull request. Try again." }, 502);
	}
}
