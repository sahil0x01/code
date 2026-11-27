import { getProjectForUser } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { getInstallationOctokit, installationPermissions } from "@/lib/github-app";
import { handleIssues } from "@/lib/issue-handler";
import { listIssues, loadIssue } from "@/lib/issue-source";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(request: NextRequest, context: RouteContext<"/api/projects/[id]/issues">) {
	const session = await getSession();
	const { id } = await context.params;

	return handleIssues(
		{
			getProject: (userId, projectId) => getProjectForUser(db, userId, projectId),
			listIssues: async (installationId, fullName) =>
				listIssues((await getInstallationOctokit(installationId)).rest, fullName),
			canReadIssues: async (installationId) => Boolean((await installationPermissions(installationId)).issues),
			loadIssue: async (installationId, fullName, number) =>
				loadIssue((await getInstallationOctokit(installationId)).rest, fullName, number),
		},
		{ userId: session?.user.id, projectId: id, number: request.nextUrl.searchParams.get("number") },
	);
}
