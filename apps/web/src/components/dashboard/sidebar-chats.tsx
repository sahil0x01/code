import { listChats } from "@nullfuse/db";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { ChatSections } from "./chat-links";

export async function SidebarChats() {
	const { user } = await requireSession();
	const chats = await listChats(db, user.id, { limit: 200 });

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<ChatSections
				chats={chats.map((chat) => ({
					id: chat.id,
					title: chat.title,
					state: chat.state,
					status: chat.lastRunStatus,
					unread: chat.unread,
				}))}
			/>
		</div>
	);
}

export function SidebarChatsSkeleton() {
	return (
		<div aria-hidden="true" className="flex flex-1 flex-col gap-2">
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
			<div className="mx-3 h-5 animate-pulse bg-surface-2" />
		</div>
	);
}
