import { getChatForUser } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { listPullComments } from "@/lib/comment-source";
import { getInstallationOctokit } from "@/lib/github-app";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

const problem = (error: string, status: number) => Response.json({ error }, { status });

export async function GET(_request: NextRequest, context: RouteContext<"/api/chats/[id]/pr/comments">) {
	const session = await getSession();
	if (!session) return problem("Sign in again to see the comments.", 401);
	const { id } = await context.params;
	const chat = z.uuid().safeParse(id).success ? await getChatForUser(db, session.user.id, id) : null;
	if (!chat || chat.installationId === null || chat.pullRequestNumber === null) {
		return problem("That pull request was not found.", 404);
	}

	try {
		const octokit = await getInstallationOctokit(chat.installationId);
		const comments = await listPullComments(octokit.rest, chat.projectName, chat.pullRequestNumber);
		return Response.json({ comments }, { headers: { "Cache-Control": "no-store" } });
	} catch (error) {
		console.error("load comments failed", error);
		return problem("GitHub didn't return the comments. Try again.", 502);
	}
}
