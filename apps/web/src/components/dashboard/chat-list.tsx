import type { listChats } from "@nullfuse/db";
import Link from "next/link";
import { relativeTime } from "@/lib/time";
import { RunStatusBadge } from "./run-status";

type Chats = Awaited<ReturnType<typeof listChats>>;

export function ChatList({
	chats,
	showProject = true,
}: {
	chats: Chats;
	showProject?: boolean;
}) {
	return (
		<ul className="flex flex-col gap-2">
			{chats.map((chat) => (
				<li key={chat.id}>
					<Link
						href={`/dashboard/chats/${chat.id}`}
						className="pixel-inset flex items-center justify-between gap-4 bg-surface px-4 py-3 hover:bg-surface-2"
					>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="truncate font-medium">{chat.title}</span>
							<span className="truncate font-mono text-xs text-muted">
								{showProject ? `${chat.projectName} · ` : ""}
								{chat.baseBranch} · {relativeTime(chat.updatedAt)}
							</span>
						</span>
						{chat.lastRunStatus && (
							<RunStatusBadge status={chat.lastRunStatus} />
						)}
					</Link>
				</li>
			))}
		</ul>
	);
}
