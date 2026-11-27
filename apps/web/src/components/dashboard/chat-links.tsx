"use client";

import type { RunStatus } from "@nullfuse/db";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RunStatusDot, UnreadMark } from "./run-status";

type Item = { id: string; title: string; status: RunStatus | null; unread: boolean };

// The sidebar's recent chats. Client side only to highlight the open one.
export function ChatLinks({ chats }: { chats: Item[] }) {
	const pathname = usePathname();

	return (
		<ul className="flex flex-col gap-0.5">
			{chats.map((chat) => {
				const href = `/dashboard/chats/${chat.id}`;
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
