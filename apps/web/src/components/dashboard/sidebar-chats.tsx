import { listChats } from "@nullfuse/db";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { ChatLinks } from "./chat-links";

const heading = "px-3 font-mono text-xs uppercase text-subtle";

export async function SidebarChats() {
	const { user } = await requireSession();
	const chats = await listChats(db, user.id, { limit: 12 });

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
			<p className={heading}>Recent</p>
			{chats.length === 0 ? (
				<p className="px-3 text-sm text-subtle">No chats yet.</p>
			) : (
				<div className="min-h-0 overflow-x-hidden overflow-y-auto">
					<ChatLinks
						chats={chats.map((chat) => ({
							id: chat.id,
							title: chat.title,
							status: chat.lastRunStatus,
							unread: chat.unread,
						}))}
					/>
				</div>
			)}
		</div>
	);
}

export function SidebarChatsSkeleton() {
	return (
		<div aria-hidden="true" className="flex flex-1 flex-col gap-2">
			<p className={heading}>Recent</p>
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
		</div>
	);
}
