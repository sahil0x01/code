import { type ChatReviewState, listChats } from "@nullfuse/db";
import { ChatList } from "@/components/dashboard/chat-list";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export const metadata = { title: "Chats" };

const sections: { state: ChatReviewState; title: string }[] = [
	{ state: "needs_review", title: "Needs review" },
	{ state: "running", title: "Running" },
	{ state: "done", title: "Done" },
];

export default async function ChatsPage() {
	const session = await requireSession();
	const chats = await listChats(db, session.user.id, { limit: 200 });

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
				sections.map(({ state, title }) => {
					const inSection = chats.filter((chat) => chat.state === state);
					if (inSection.length === 0) return null;
					return (
						<section key={state} className="flex flex-col gap-2">
							<h2 className="font-mono text-xs uppercase text-subtle">
								{title} ({inSection.length})
							</h2>
							<ChatList chats={inSection} />
						</section>
					);
				})
			)}
		</div>
	);
}
