import { getChatForUser } from "@nullfuse/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PageHeader } from "@/components/dashboard/page-header";
import { PreviewPanel } from "@/components/dashboard/preview-panel";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export const metadata = { title: "Preview" };

export default async function PreviewPage({ params }: PageProps<"/dashboard/chats/[id]/preview">) {
	const session = await requireSession();
	const { id } = await params;

	if (!z.uuid().safeParse(id).success) notFound();
	const chat = await getChatForUser(db, session.user.id, id);
	if (!chat) notFound();

	return (
		<div className="flex flex-col gap-6">
			<Link href={`/dashboard/chats/${chat.id}`} className="font-mono text-xs uppercase text-subtle hover:text-foreground">
				← Back to the chat
			</Link>
			<PageHeader title="Preview" description={chat.title} />
			<PreviewPanel key={chat.id} chatId={chat.id} />
		</div>
	);
}
