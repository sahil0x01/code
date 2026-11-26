"use client";

import { type ReactNode, useState } from "react";

const tabs = [
	{ id: "chat", label: "Chat" },
	{ id: "changes", label: "Changes" },
] as const;

type Props = { thread: ReactNode; composer: ReactNode; changes: ReactNode };

// Side by side on wide screens, one at a time with tabs on narrow ones. Each side
// scrolls on its own and the composer stays at the bottom.
export function ChatWorkspace({ thread, composer, changes }: Props) {
	const [active, setActive] = useState<(typeof tabs)[number]["id"]>("chat");

	return (
		<div className="flex min-h-0 flex-1 flex-col xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-rows-1">
			<div className="flex shrink-0 gap-4 border-b border-border md:px-5 xl:hidden">
				{tabs.map((tab) => (
					<button
						key={tab.id}
						type="button"
						aria-pressed={active === tab.id}
						onClick={() => setActive(tab.id)}
						className="py-2 text-sm font-medium text-muted aria-pressed:border-b-2 aria-pressed:border-ink aria-pressed:text-foreground"
					>
						{tab.label}
					</button>
				))}
			</div>
			<div
				className={`${active === "chat" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col xl:flex`}
			>
				{thread}
				<div className="sticky bottom-0 shrink-0 bg-background pt-1 pb-3 md:static">
					<div className="mx-auto w-full max-w-3xl px-1 md:px-5">{composer}</div>
				</div>
			</div>
			<div
				className={`${active === "changes" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col xl:flex xl:border-l xl:border-border`}
			>
				{changes}
			</div>
		</div>
	);
}
