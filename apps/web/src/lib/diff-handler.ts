import { z } from "zod";
import type { DiffResponse } from "./diff";
import type { DiffRequest } from "./diff-source";

type Chat = {
	baseBranch: string;
	workingBranch: string | null;
	pullRequestNumber: number | null;
	projectName: string;
	installationId: number | null;
};

export type DiffDeps = {
	getChat(userId: string, chatId: string): Promise<Chat | null>;
	loadDiff(installationId: number, request: DiffRequest): Promise<DiffResponse>;
};

const sha = z.string().regex(/^[0-9a-f]{40}$/);

function json(body: DiffResponse | { error: string }, status = 200) {
	return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleDiff(
	deps: DiffDeps,
	input: { userId: string | undefined; chatId: string; head: string | null },
) {
	if (!input.userId) return json({ error: "Sign in again to see the changes." }, 401);

	const notFound = () => json({ error: "That chat was not found." }, 404);
	if (!z.uuid().safeParse(input.chatId).success) return notFound();
	const chat = await deps.getChat(input.userId, input.chatId);
	if (!chat) return notFound();

	if (chat.installationId === null) return json({ state: "disconnected" });
	if (!chat.workingBranch) return json({ state: "not_pushed" });

	try {
		return json(
			await deps.loadDiff(chat.installationId, {
				fullName: chat.projectName,
				baseBranch: chat.baseBranch,
				workingBranch: chat.workingBranch,
				pullNumber: chat.pullRequestNumber,
				knownHead: sha.safeParse(input.head).data,
			}),
		);
	} catch (error) {
		console.error("load diff failed", error);
		return json({ error: "GitHub didn't return the changes. Try again." }, 502);
	}
}
