import { listChats } from "@nullfuse/db";
import { ChatList } from "@/components/dashboard/chat-list";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export const metadata = { title: "Chats" };

export default async function ChatsPage() {
	const session = await requireSession();
	const chats = await listChats(db, session.user.id);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Chats"
				description="Your conversations with the agent, across all projects."
			/>

			{chats.length === 0 ? (
				<EmptyState
					title="No chats yet"
					description="A chat is a conversation with the agent about one project. Describe what you want done, then keep talking to refine it."
					action={{ label: "Start a chat", href: "/dashboard/chats/new" }}
				/>
			) : (
				<ChatList chats={chats} />
			)}
		</div>
	);
}
