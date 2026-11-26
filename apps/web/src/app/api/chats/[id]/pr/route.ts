import { getChatForUser } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { handlePull } from "@/lib/pr-handler";
import { loadPull } from "@/lib/pr-source";
import { getInstallationOctokit } from "@/lib/github-app";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(_request: NextRequest, context: RouteContext<"/api/chats/[id]/pr">) {
	const session = await getSession();
	const { id } = await context.params;

	return handlePull(
		{
			getChat: (userId, chatId) => getChatForUser(db, userId, chatId),
			loadPull: async (installationId, fullName, number) => {
				const octokit = await getInstallationOctokit(installationId);
				return loadPull(octokit.rest, fullName, number);
			},
		},
		{ userId: session?.user.id, chatId: id },
	);
}
