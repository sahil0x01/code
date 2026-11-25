import { getChatForUser, listMessages, listRuns } from "@nullfuse/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { cancelQueuedRun } from "@/actions/chats";
import { PageHeader } from "@/components/dashboard/page-header";
import { RunStatusBadge } from "@/components/dashboard/run-status";
import { buttonClass } from "@/components/ui/styles";
import { DEFAULT_MODEL_ID, isModelId } from "@/lib/chat";
import { relativeTime } from "@/lib/time";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { DeleteChatButton } from "./delete-chat-button";
import { MessageForm } from "./message-form";

export const metadata = { title: "Chat" };

export default async function ChatPage({
	params,
}: PageProps<"/dashboard/chats/[id]">) {
	const session = await requireSession();
	const { id } = await params;

	if (!z.uuid().safeParse(id).success) notFound();
	const chat = await getChatForUser(db, session.user.id, id);
	if (!chat) notFound();

	const [messages, runs] = await Promise.all([
		listMessages(db, session.user.id, chat.id),
		listRuns(db, session.user.id, chat.id),
	]);

	const runByMessage = new Map(
		runs.map((run) => [run.messageId, run] as const),
	);
	const unfinished = runs.filter(
		(run) => run.status === "queued" || run.status === "running",
	);
	const lastModel = runs.at(-1)?.model;
	const defaultModel =
		lastModel && isModelId(lastModel) ? lastModel : DEFAULT_MODEL_ID;

	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				crumb={{ href: "/dashboard/chats", label: "Chats" }}
				title={chat.title}
				description={
					<span className="font-mono text-xs">
						<Link
							href={`/dashboard/projects/${chat.projectId}`}
							className="underline hover:text-foreground"
						>
							{chat.projectName}
						</Link>
						{" · "}
						{chat.baseBranch}
						{chat.workingBranch ? ` → ${chat.workingBranch}` : ""}
						{chat.connected ? "" : " · disconnected"}
					</span>
				}
				actions={<DeleteChatButton chatId={chat.id} />}
			/>

			<ol className="flex flex-col gap-6">
				{messages.map((message) => {
					const run = runByMessage.get(message.id);
					const isUser = message.role === "user";
					return (
						<li key={message.id} className="flex flex-col gap-2">
							<p className="flex items-center gap-2 font-mono text-xs uppercase text-subtle">
								<span>{isUser ? "You" : "Agent"}</span>
								<span aria-hidden="true">·</span>
								<time
									dateTime={message.createdAt.toISOString()}
									title={message.createdAt.toLocaleString("en")}
								>
									{relativeTime(message.createdAt)}
								</time>
							</p>
							<div
								className={`pixel-inset whitespace-pre-wrap break-words p-4 text-[15px] leading-relaxed ${
									isUser ? "bg-surface" : "bg-surface-2"
								}`}
							>
								{message.content}
							</div>
							{run && (
								<div className="ml-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-l-2 border-border pl-4">
									<RunStatusBadge
										status={run.status}
										ahead={unfinished.findIndex((other) => other.id === run.id)}
									/>
									<span className="font-mono text-xs text-subtle">
										{run.model}
									</span>
									{run.status === "queued" && (
										<form action={cancelQueuedRun}>
											<input type="hidden" name="runId" value={run.id} />
											<button
												type="submit"
												className={buttonClass("secondary", "sm")}
											>
												Cancel
											</button>
										</form>
									)}
								</div>
							)}
						</li>
					);
				})}
			</ol>

			<div className="sticky bottom-0 -mx-5 border-t border-border bg-background px-5 pt-4 pb-5 md:-mx-10 md:px-10 md:pb-6">
				{chat.connected ? (
					<MessageForm chatId={chat.id} defaultModel={defaultModel} />
				) : (
					<p className="text-sm text-muted">
						This project is disconnected from GitHub, so the chat is read-only.
						Reconnect the project to keep working.
					</p>
				)}
			</div>
		</div>
	);
}
