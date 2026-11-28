import { z } from "zod";
import type { FileList } from "./file-source";
import { errorStatus } from "@nullfuse/connectors/pulls";

type Project = { fullName: string; installationId: number | null; defaultBranch: string };

export type FileDeps = {
	getProject(userId: string, projectId: string): Promise<Project | null>;
	listFiles(installationId: number, fullName: string, branch: string): Promise<FileList>;
};

function json(body: FileList | { error: string }, status = 200) {
	return Response.json(body, { status, headers: { "Cache-Control": "private, max-age=60" } });
}

/** The paths of a branch, falling back to the default one while a chat's branch does not exist yet. */
export async function handleFiles(
	deps: FileDeps,
	input: { userId: string | undefined; projectId: string; branch: string | null },
) {
	if (!input.userId) return json({ error: "Sign in again." }, 401);
	const branch = z.string().min(1).max(250).nullable().safeParse(input.branch);
	if (!z.uuid().safeParse(input.projectId).success || !branch.success) {
		return json({ error: "That project was not found." }, 404);
	}
	const project = await deps.getProject(input.userId, input.projectId);
	if (!project) return json({ error: "That project was not found." }, 404);
	const { installationId, fullName, defaultBranch } = project;
	if (installationId === null) return json({ error: "This project is disconnected from GitHub." }, 409);

	try {
		const wanted = branch.data ?? defaultBranch;
		try {
			return json(await deps.listFiles(installationId, fullName, wanted));
		} catch (error) {
			if (errorStatus(error) !== 404 || wanted === defaultBranch) throw error;
			return json(await deps.listFiles(installationId, fullName, defaultBranch));
		}
	} catch (error) {
		console.error("list files failed", errorStatus(error) ?? error);
		return json({ error: "GitHub didn't return the files." }, 502);
	}
}
