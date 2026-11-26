import { getChatForUser } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { handleDiff } from "@/lib/diff-handler";
import { loadDiff } from "@/lib/diff-source";
import { getInstallationOctokit } from "@/lib/github-app";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(request: NextRequest, context: RouteContext<"/api/chats/[id]/diff">) {
	const session = await getSession();
	const { id } = await context.params;

	return handleDiff(
		{
			getChat: (userId, chatId) => getChatForUser(db, userId, chatId),
			loadDiff: async (installationId, diffRequest) => {
				const octokit = await getInstallationOctokit(installationId);
				return loadDiff(octokit.rest, diffRequest);
			},
		},
		{ userId: session?.user.id, chatId: id, head: request.nextUrl.searchParams.get("head") },
	);
}
