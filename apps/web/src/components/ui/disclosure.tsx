"use client";

import { type ReactNode, useState } from "react";
import { PixelChevron } from "./pixel-chevron";

type Props = {
	summary: ReactNode;
	children: ReactNode;
	/** Followed until the reader opens or closes it themselves. */
	defaultOpen?: boolean;
	onOpen?(): void;
	className?: string;
	summaryClass?: string;
};

/** A section that folds smoothly. Its content is first rendered when it is first open. */
export function Disclosure({ summary, children, defaultOpen = false, onOpen, className = "", summaryClass = "" }: Props) {
	const [chosen, setChosen] = useState<boolean>();
	const open = chosen ?? defaultOpen;
	const [rendered, setRendered] = useState(open);
	// Stays rendered after closing, so the closing can be seen.
	if (open && !rendered) setRendered(true);

	return (
		<div className={`min-w-0 ${className}`}>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => {
					setChosen(!open);
					if (!open) onOpen?.();
				}}
				className={`flex max-w-full cursor-pointer items-start gap-2 text-left text-subtle hover:text-foreground ${summaryClass}`}
			>
				{/* One line high, so the marker sits beside the first line of a wrapped summary. */}
				<span className="flex h-[1lh] items-center">
					<PixelChevron open={open} />
				</span>
				<span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">{summary}</span>
			</button>
			<div
				inert={!open}
				className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
					open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
				}`}
			>
				<div className="relative min-h-0 min-w-0 overflow-hidden">{rendered && children}</div>
			</div>
		</div>
	);
}
