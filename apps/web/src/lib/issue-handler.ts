import { z } from "zod";
import { type Issue, issueMessage, type IssueSummary } from "./issue";
import { errorStatus } from "./pr-source";

type Project = { fullName: string; installationId: number | null };

export type IssueDeps = {
	getProject(userId: string, projectId: string): Promise<Project | null>;
	listIssues(installationId: number, fullName: string): Promise<IssueSummary[]>;
	/** Whether the installation was granted read access to Issues. */
	canReadIssues(installationId: number): Promise<boolean>;
	loadIssue(installationId: number, fullName: string, number: number): Promise<Issue | null>;
};

export type IssueListResponse = { issues: IssueSummary[] };
export type IssueResponse = { number: number; message: string };

function json(body: IssueListResponse | IssueResponse | { error: string }, status = 200) {
	return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Without a number, lists the open issues. With one, gives the message to start a chat with. */
export async function handleIssues(
	deps: IssueDeps,
	input: { userId: string | undefined; projectId: string; number: string | null },
) {
	if (!input.userId) return json({ error: "Sign in again to see the issues." }, 401);

	const notFound = () => json({ error: "That project or issue was not found." }, 404);
	const number = z.coerce.number().int().positive().nullable().safeParse(input.number);
	if (!z.uuid().safeParse(input.projectId).success || !number.success) return notFound();
	const project = await deps.getProject(input.userId, input.projectId);
	if (!project) return notFound();
	if (project.installationId === null) return json({ error: "This project is disconnected from GitHub." }, 409);

	const refused = () =>
		json(
			{ error: "The GitHub App can't read Issues here. Approve its new permissions in GitHub, then try again." },
			403,
		);
	try {
		if (number.data === null) {
			const issues = await deps.listIssues(project.installationId, project.fullName);
			// Without the permission GitHub lists only pull requests, which looks like no issues.
			if (issues.length === 0 && !(await deps.canReadIssues(project.installationId))) return refused();
			return json({ issues });
		}
		const issue = await deps.loadIssue(project.installationId, project.fullName, number.data);
		return issue ? json({ number: issue.number, message: issueMessage(issue) }) : notFound();
	} catch (error) {
		const status = errorStatus(error);
		if (status === 404) return notFound();
		if (status === 403) return refused();
		if (status === 410) return json({ error: "Issues are turned off for this repository." }, 409);
		console.error("load issues failed", error);
		return json({ error: "GitHub didn't return the issues. Try again." }, 502);
	}
}
