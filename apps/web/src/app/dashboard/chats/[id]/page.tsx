import {
	getChatForUser,
	listMessages,
	listOverlaps,
	listRunActivity,
	listRuns,
} from "@nullfuse/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { AutoRefresh } from "@/components/dashboard/auto-refresh";
import { ChangesPanel } from "@/components/dashboard/changes-panel";
import { ChatThread } from "@/components/dashboard/chat-thread";
import { ChatWorkspace } from "@/components/dashboard/chat-workspace";
import { DoneButton } from "@/components/dashboard/done-button";
import { MarkSeen } from "@/components/dashboard/mark-seen";
import { Markdown } from "@/components/dashboard/markdown";
import { PullBar } from "@/components/dashboard/pull-bar";
import { RunPanel } from "@/components/dashboard/run-panel";
import { buttonClass } from "@/components/ui/styles";
import { DEFAULT_MODEL_ID, DEFAULT_REASONING, isModelId } from "@/lib/chat";
import { formatCost } from "@/lib/format";
import { db } from "@/server/db";
import { recordingStore } from "@/server/recordings";
import { requireSession } from "@/server/session";
import { DeleteChatButton } from "./delete-chat-button";
import { MessageForm } from "./message-form";

export const metadata = { title: "Chat" };

// Older runs show their summary; their steps are only loaded for the latest few.
const RUNS_WITH_ACTIVITY = 5;

type Message = Awaited<ReturnType<typeof listMessages>>[number];

function MessageView({ message }: { message: Message }) {
	const sent = message.createdAt.toLocaleString("en");
	if (message.role === "user") {
		return (
			<div
				title={sent}
				className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap break-words border border-border bg-surface-2 px-4 py-2.5 text-[15px] leading-relaxed"
			>
				<span className="sr-only">You: </span>
				{message.content}
			</div>
		);
	}
	return (
		<div title={sent}>
			<span className="sr-only">Agent: </span>
			<Markdown text={message.content} />
		</div>
	);
}

function Overlaps({ overlaps }: { overlaps: Awaited<ReturnType<typeof listOverlaps>> }) {
	if (overlaps.length === 0) return null;
	const count = overlaps.length === 1 ? "1 other open chat" : `${overlaps.length} other open chats`;
	return (
		<details className="shrink-0 border-b border-border bg-surface px-3 py-2 md:px-5">
			<summary className="w-fit cursor-pointer font-mono text-xs text-muted">
				{count} changed the same files. Merging one may cause conflicts in the others.
			</summary>
			<ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pt-2 font-mono text-xs">
				{overlaps.map((other) => (
					<li key={other.chatId} className="flex flex-wrap gap-x-2">
						<Link href={`/dashboard/chats/${other.chatId}`} className="underline hover:text-foreground">
							{other.title}
						</Link>
						<span className="break-all text-subtle">{other.files.join(", ")}</span>
					</li>
				))}
			</ul>
		</details>
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

	const [messages, runs, overlaps] = await Promise.all([
		listMessages(db, session.user.id, chat.id),
		listRuns(db, session.user.id, chat.id),
		listOverlaps(db, session.user.id, chat.id),
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
	const latestResult = runs.reduce<Date | null>(
		(latest, run) =>
			run.finishedAt && (!latest || run.finishedAt > latest) ? run.finishedAt : latest,
		null,
	);
	const reviewable = runs.some((run) => run.startedAt && run.finishedAt);
	const lastModel = runs.at(-1)?.model;
	const defaultModel =
		lastModel && isModelId(lastModel) ? lastModel : DEFAULT_MODEL_ID;
	const defaultReasoning = runs.at(-1)?.reasoning ?? DEFAULT_REASONING;
	const tests = runs.findLast((run) => run.verification)?.verification;
	const testsPassed = tests && tests.exitCode === 0 && !tests.timedOut;
	// A new step, status or PR can mean new commits on the branch.
	const refreshKey = [
		chat.workingBranch,
		chat.pullRequestNumber,
		...runs.map((run) => `${run.status}:${stepsByRun.get(run.id)?.length ?? 0}`),
	].join("|");

	const running = runs.find((run) => run.status === "running");
	const canPlay = recordingStore() !== null;
	const chatCost = runs.reduce((sum, run) => sum + run.modelCost + run.sandboxCost, 0);
	const hasPull = chat.pullRequestNumber !== null && chat.pullRequestUrl?.startsWith("https://");

	return (
		// Covers the area beside the sidebar so each column can scroll by itself.
		<div className="flex min-h-[70dvh] flex-col bg-background md:fixed md:inset-y-0 md:right-0 md:left-64 md:min-h-0">
			<AutoRefresh active={unfinished.length > 0} />
			{chat.unread && latestResult && (
				<MarkSeen chatId={chat.id} until={latestResult.toISOString()} />
			)}

			<header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border pb-3 md:px-5 md:py-2.5">
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-sm font-semibold" title={chat.title}>
						{chat.title}
					</h1>
					<p className="truncate font-mono text-xs text-muted">
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
						{chatCost > 0 && (
							<span title="Estimate from list prices, for runs that recorded a cost">
								{` · about ${formatCost(chatCost)}`}
							</span>
						)}
					</p>
				</div>
				{tests && (
					<span className={`font-mono text-xs ${testsPassed ? "text-green" : "text-red"}`}>
						{testsPassed ? "Tests passed" : "Tests failed"}
					</span>
				)}
				{chat.connected && chat.canRecord && chat.workingBranch && (
					<Link href={`/dashboard/chats/${chat.id}/preview`} className={buttonClass("secondary", "sm")}>
						Preview
					</Link>
				)}
				{chat.state !== "running" && reviewable && (
					<DoneButton chatId={chat.id} done={chat.state === "done"} />
				)}
				<DeleteChatButton chatId={chat.id} />
			</header>

			{chat.state !== "done" && <Overlaps overlaps={overlaps} />}

			<ChatWorkspace
				thread={
					<ChatThread key={chat.id}>
						<ol className="flex flex-col gap-6">
							{shown.map((message) => {
								const run = runByMessage.get(message.id);
								return (
									<li key={message.id} className="flex flex-col gap-4">
										<MessageView message={message} />
										{run && (
											<RunPanel
												chatId={chat.id}
												canPlay={canPlay}
												run={run}
												steps={stepsByRun.get(run.id) ?? []}
												ahead={unfinished.findIndex((other) => other.id === run.id)}
											/>
										)}
										{run &&
											(answersByRun.get(run.id) ?? []).map((answer) => (
												<MessageView key={answer.id} message={answer} />
											))}
									</li>
								);
							})}
						</ol>
					</ChatThread>
				}
				composer={
					chat.connected ? (
						<MessageForm
							key={chat.id}
							chatId={chat.id}
							defaultModel={defaultModel}
							defaultReasoning={defaultReasoning}
							canRecord={chat.canRecord}
							running={
								running && { id: running.id, stopping: running.stopRequestedAt !== null }
							}
						/>
					) : (
						<p className="text-sm text-muted">
							This project is disconnected from GitHub, so the chat is read-only. Reconnect the
							project to keep working.
						</p>
					)
				}
				changes={
					<>
						{hasPull && chat.pullRequestNumber !== null && chat.pullRequestUrl && (
							<PullBar
								key={chat.id}
								chatId={chat.id}
								number={chat.pullRequestNumber}
								url={chat.pullRequestUrl}
								model={defaultModel}
								busy={unfinished.length > 0}
								refreshKey={refreshKey}
							/>
						)}
						{!chat.pullRequestUrl && chat.pullRequestError && (
							<p role="alert" className="shrink-0 px-4 pt-3 text-sm text-red">
								Could not open a pull request: {chat.pullRequestError}
							</p>
						)}
						<div className="min-h-0 flex-1 md:overflow-y-auto">
							<ChangesPanel
								key={chat.id}
								chatId={chat.id}
								model={defaultModel}
								reasoning={defaultReasoning}
								refreshKey={refreshKey}
							/>
						</div>
					</>
				}
			/>
		</div>
	);
}
