import "server-only";
import { type TaskInput, type TaskResult, startConnectorTask } from "@nullfuse/connectors";
import { commandOptions } from "@nullfuse/agent/commands";
import { DEFAULT_MODEL_ID, DEFAULT_REASONING, MAX_MESSAGE_LENGTH } from "@/lib/chat";
import { db } from "@/server/db";
import { enqueueRun } from "@/server/enqueue";
import { checkRepo } from "@/server/github-checks";

type Task = Omit<TaskInput, "model" | "reasoning" | "planOnly" | "verify">;

/** Why a task can't be sent as written, or null. */
export function taskProblem(content: string) {
	if (content.length > MAX_MESSAGE_LENGTH) return "That task is too long.";
	if (commandOptions(content).missingTask) return "Say what to do after the command.";
	return null;
}

/** Starts a task from an outside tool with the default model. Null when it failed unexpectedly. */
export async function runConnectorTask(task: Task): Promise<TaskResult | null> {
	const { planOnly, verify } = commandOptions(task.content);
	try {
		return await startConnectorTask(
			{
				db,
				canRead: async (project) =>
					(await checkRepo(project.installationId, project.fullName, project.defaultBranch)) === "ok",
				enqueue: enqueueRun,
			},
			{ ...task, model: DEFAULT_MODEL_ID, reasoning: DEFAULT_REASONING, planOnly, verify },
		);
	} catch (error) {
		console.error(`${task.provider} task failed`, error);
		return null;
	}
}

export const TASK_FAILED = "Something went wrong. Try again.";
