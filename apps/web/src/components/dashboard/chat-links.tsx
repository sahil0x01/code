"use client";

import type { ChatReviewState, RunStatus } from "@nullfuse/db";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { RunStatusDot, UnreadMark } from "./run-status";

type Item = {
	id: string;
	title: string;
	state: ChatReviewState;
	status: RunStatus | null;
	unread: boolean;
};

const sections: { state: ChatReviewState; title: string }[] = [
	{ state: "needs_review", title: "Needs review" },
	{ state: "running", title: "Running" },
	{ state: "done", title: "Done" },
];

const chatPath = (id: string) => `/dashboard/chats/${id}`;

// The sidebar's chats by review state. One section is open at a time, so every
// heading stays in reach however long a list gets. Client side to highlight the
// open chat and to keep the section while moving between chats.
export function ChatSections({ chats }: { chats: Item[] }) {
	const pathname = usePathname();
	const firstFilled = () => sections.find(({ state }) => chats.some((c) => c.state === state))?.state;
	// Starts on the open chat's section. It does not follow the chat afterwards, so
	// marking one done leaves the rest of the list in place.
	const [open, setOpen] = useState<ChatReviewState | null | undefined>(
		() => chats.find((chat) => pathname === chatPath(chat.id))?.state,
	);
	const shown = open === undefined ? firstFilled() : open;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-1">
			{sections.map(({ state, title }) => {
				const items = chats.filter((chat) => chat.state === state);
				const expanded = shown === state && items.length > 0;
				return (
					<section key={state} className={`flex flex-col gap-0.5 ${expanded ? "min-h-0" : "shrink-0"}`}>
						<h2 className="shrink-0">
							<button
								type="button"
								aria-expanded={expanded}
								disabled={items.length === 0}
								onClick={() => setOpen(expanded ? null : state)}
								className="flex w-full items-center gap-2 px-3 py-1.5 font-mono text-xs uppercase text-subtle enabled:hover:text-foreground"
							>
								<span aria-hidden="true" className="w-2">
									{expanded ? "▾" : "▸"}
								</span>
								<span>{title}</span>
								<span className="ml-auto">{items.length}</span>
							</button>
						</h2>
						{expanded && (
							<div className="min-h-0 overflow-x-hidden overflow-y-auto">
								<ChatLinks chats={items} pathname={pathname} />
							</div>
						)}
					</section>
				);
			})}
		</div>
	);
}

function ChatLinks({ chats, pathname }: { chats: Item[]; pathname: string }) {
	return (
		<ul className="flex flex-col gap-0.5">
			{chats.map((chat) => {
				const href = chatPath(chat.id);
				const active = pathname === href;
				return (
					<li key={chat.id}>
						<Link
							href={href}
							aria-current={active ? "page" : undefined}
							title={chat.title}
							className={`flex items-center gap-2.5 border-l-2 px-3 py-1.5 text-sm ${
								active
									? "border-accent bg-surface-2 font-medium text-foreground"
									: "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
							}`}
						>
							<RunStatusDot status={chat.status} />
							<span
								className={`min-w-0 truncate ${chat.unread ? "font-semibold text-foreground" : ""}`}
							>
								{chat.title}
							</span>
							{chat.unread && <UnreadMark />}
						</Link>
					</li>
				);
			})}
		</ul>
	);
}
