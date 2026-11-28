import type { TaskResult } from "@nullfuse/connectors";

/** What the person is told after sending a task. */
export function taskReply(result: TaskResult, appUrl: string, escape: (text: string) => string = (text) => text) {
	const page = (path: string) => new URL(path, appUrl).toString();
	if (result.ok) {
		return `Started in ${escape(result.projectName)}. You'll get a message when it finishes.\n${page(`/dashboard/chats/${result.chatId}`)}`;
	}
	const settings = page("/dashboard/settings#connections");
	switch (result.reason) {
		case "not_linked":
			return `This account is not linked yet. Connect it first: ${settings}`;
		case "no_project":
			return `Choose which project tasks from here go to: ${settings}`;
		case "disconnected":
		case "unreadable":
			return `The app can't read that repository any more. Check your projects: ${page("/dashboard/projects")}`;
		case "merged":
			return "That pull request is merged. Open a new issue or start a new chat for further changes.";
		case "queue_full":
			return "You have too many unfinished runs. Wait for some to finish, then send it again.";
		case "duplicate":
			return "That task was already received.";
		case "not_found":
		case "model_removed":
			return "The task could not be started. Try again from the website.";
	}
}
