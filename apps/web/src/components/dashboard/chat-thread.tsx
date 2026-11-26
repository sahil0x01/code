"use client";

import { type ReactNode, useEffect, useRef } from "react";

const NEAR_BOTTOM_PX = 120;

// The scrolling message list. It follows new content unless the reader has scrolled up.
export function ChatThread({ children }: { children: ReactNode }) {
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const follow = useRef(true);

	useEffect(() => {
		const box = scroller.current;
		const inner = content.current;
		if (!box || !inner) return;
		const observer = new ResizeObserver(() => {
			if (follow.current) box.scrollTop = box.scrollHeight;
		});
		observer.observe(inner);
		observer.observe(box);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={scroller}
			onScroll={(event) => {
				const box = event.currentTarget;
				follow.current = box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX;
			}}
			className="min-h-0 flex-1 md:overflow-y-auto"
		>
			<div ref={content} className="mx-auto w-full max-w-3xl px-1 py-4 md:px-5">
				{children}
			</div>
		</div>
	);
}
