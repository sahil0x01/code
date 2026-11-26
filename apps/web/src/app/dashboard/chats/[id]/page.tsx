import {
	getChatForUser,
	listMessages,
	listRunActivity,
	listRuns,
} from "@nullfuse/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { PageHeader } from "@/components/dashboard/page-header";
import { RunPanel } from "@/components/dashboard/run-panel";
import { DEFAULT_MODEL_ID, isModelId } from "@/lib/chat";
import { relativeTime } from "@/lib/time";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { DeleteChatButton } from "./delete-chat-button";
import { MessageForm } from "./message-form";

export const metadata = { title: "Chat" };

// Older runs show their summary; their steps are only loaded for the latest few.
const RUNS_WITH_ACTIVITY = 5;

type Message = Awaited<ReturnType<typeof listMessages>>[number];

function Bubble({ message }: { message: Message }) {
	const isUser = message.role === "user";
	return (
		<div className="flex flex-col gap-2">
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
		</div>
	);
}

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
	const activity = await listRunActivity(
		db,
		session.user.id,
		runs.slice(-RUNS_WITH_ACTIVITY).map((run) => run.id),
	);

	const runByMessage = new Map(runs.map((run) => [run.messageId, run] as const));
	const runIds = new Set(runs.map((run) => run.id));
	const stepsByRun = Map.groupBy(activity, (step) => step.runId);
	const answersByRun = Map.groupBy(
		messages.filter((message) => message.runId !== null && runIds.has(message.runId)),
		(message) => message.runId,
	);
	const shown = messages.filter(
		(message) => message.runId === null || !runIds.has(message.runId),
	);

	const unfinished = runs.filter(
		(run) => run.status === "queued" || run.status === "running",
	);
	const lastModel = runs.at(-1)?.model;
	const defaultModel =
		lastModel && isModelId(lastModel) ? lastModel : DEFAULT_MODEL_ID;

	return (
		<div className="flex flex-col gap-8">
			<AutoRefresh active={unfinished.length > 0} />

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

			{chat.pullRequestUrl?.startsWith("https://") && (
				<a
					href={chat.pullRequestUrl}
					target="_blank"
					rel="noreferrer"
					className="w-fit font-mono text-sm underline hover:text-foreground"
				>
					Pull request #{chat.pullRequestNumber} ↗
				</a>
			)}
			{!chat.pullRequestUrl && chat.pullRequestError && (
				<p role="alert" className="text-sm text-red">
					Could not open a pull request: {chat.pullRequestError}
				</p>
			)}

			<ol className="flex flex-col gap-6">
				{shown.map((message) => {
					const run = runByMessage.get(message.id);
					return (
						<li key={message.id} className="flex flex-col gap-3">
							<Bubble message={message} />
							{run && (
								<RunPanel
									run={run}
									steps={stepsByRun.get(run.id) ?? []}
									ahead={unfinished.findIndex((other) => other.id === run.id)}
								/>
							)}
							{run &&
								(answersByRun.get(run.id) ?? []).map((answer) => (
									<Bubble key={answer.id} message={answer} />
								))}
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
