import {
	addMessage,
	attachConnectorRun,
	claimConnectorRequest,
	type ConnectorProvider,
	createChat,
	type Db,
	findConnection,
	type ReasoningLevel,
	type SendResult,
} from "@nullfuse/db";

export type TaskInput = {
	provider: ConnectorProvider;
	workspaceId: string;
	externalUserId: string;
	externalId: string;
	content: string;
	model: string;
	reasoning: ReasoningLevel;
	planOnly: boolean;
	verify: boolean;
	/** Continue this chat of the person's instead of starting one. */
	chatId?: string;
	issueNumber?: number;
	/** Where to reply, when not to the person. */
	target?: string;
};

export type TaskDeps = {
	db: Db;
	/** Whether the app can still read the repository. */
	canRead(project: { installationId: number; fullName: string; defaultBranch: string }): Promise<boolean>;
	enqueue(run: { runId: string; chatId: string }): Promise<void>;
};

export type TaskResult =
	| { ok: true; chatId: string; projectName: string }
	| {
			ok: false;
			reason: "not_linked" | "no_project" | "unreadable" | "duplicate" | Extract<SendResult, { ok: false }>["reason"];
	  };

/** Starts a chat for a linked person. Nobody else can start a run. */
export async function startConnectorTask(deps: TaskDeps, input: TaskInput): Promise<TaskResult> {
	const link = await findConnection(deps.db, input);
	if (!link) return { ok: false, reason: "not_linked" };
	const project = link.project;
	if (!project) return { ok: false, reason: "no_project" };
	const { installationId } = project;
	if (installationId === null) return { ok: false, reason: "disconnected" };
	if (!(await deps.canRead({ ...project, installationId }))) return { ok: false, reason: "unreadable" };

	const key = { connectionId: link.id, externalId: input.externalId };
	if (!(await claimConnectorRequest(deps.db, key))) return { ok: false, reason: "duplicate" };

	const options = {
		userId: link.userId,
		model: input.model,
		reasoning: input.reasoning,
		planOnly: input.planOnly,
		verify: input.verify,
		content: input.content,
	};
	const created = input.chatId
		? await addMessage(deps.db, { ...options, chatId: input.chatId })
		: await createChat(deps.db, {
				...options,
				projectId: project.id,
				baseBranch: project.defaultBranch,
				issueNumber: input.issueNumber,
			});
	if (!created.ok) return { ok: false, reason: created.reason };
	// Saved before the run is started, so even a very quick run finds who to answer.
	await attachConnectorRun(deps.db, key, created.runId, input.target);
	await deps.enqueue({ runId: created.runId, chatId: created.chatId });
	return { ok: true, chatId: created.chatId, projectName: project.fullName };
}
