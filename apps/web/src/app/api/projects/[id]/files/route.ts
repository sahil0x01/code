import { getProjectForUser } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { handleFiles } from "@/lib/file-handler";
import { listFiles } from "@/lib/file-source";
import { getInstallationOctokit } from "@/lib/github-app";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(request: NextRequest, context: RouteContext<"/api/projects/[id]/files">) {
	const session = await getSession();
	const { id } = await context.params;

	return handleFiles(
		{
			getProject: (userId, projectId) => getProjectForUser(db, userId, projectId),
			listFiles: async (installationId, fullName, branch) =>
				listFiles((await getInstallationOctokit(installationId)).rest, fullName, branch),
		},
		{ userId: session?.user.id, projectId: id, branch: request.nextUrl.searchParams.get("branch") },
	);
}
