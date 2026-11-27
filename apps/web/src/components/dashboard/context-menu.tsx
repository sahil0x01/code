"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { PixelIcon, type IconName } from "@/components/ui/pixel-icon";

export type MenuPosition = { x: number; y: number };

const WIDTH = 160;
const ITEM_HEIGHT = 36;

/** A small menu at a point on the screen. Closes on Escape, a click elsewhere, scrolling or resizing. */
export function ContextMenu({
	at,
	items,
	onClose,
}: {
	at: MenuPosition;
	items: { label: string; icon: IconName; onSelect(): void }[];
	onClose(): void;
}) {
	const menu = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const before = document.activeElement as HTMLElement | null;
		menu.current?.querySelector("button")?.focus();
		const away = (event: Event) => {
			if (!menu.current?.contains(event.target as Node)) onClose();
		};
		document.addEventListener("pointerdown", away);
		document.addEventListener("scroll", away, true);
		window.addEventListener("resize", onClose);
		return () => {
			document.removeEventListener("pointerdown", away);
			document.removeEventListener("scroll", away, true);
			window.removeEventListener("resize", onClose);
			// Focus goes back to the row, unless a choice has already moved it on.
			if (!document.activeElement || document.activeElement === document.body) before?.focus();
		};
	}, [onClose]);

	// Kept inside the window when opened near its edge.
	const left = Math.max(4, Math.min(at.x, window.innerWidth - WIDTH - 4));
	const top = Math.max(4, Math.min(at.y, window.innerHeight - items.length * ITEM_HEIGHT - 12));

	return createPortal(
		<div
			ref={menu}
			role="menu"
			style={{ left, top, width: WIDTH }}
			className="pixel-inset fixed z-50 flex flex-col bg-background py-1"
			onContextMenu={(event) => event.preventDefault()}
			onKeyDown={(event) => {
				if (event.key === "Escape" || event.key === "Tab") {
					event.preventDefault();
					onClose();
					return;
				}
				const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
				if (move === 0) return;
				event.preventDefault();
				const buttons = [...(menu.current?.querySelectorAll("button") ?? [])];
				const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
				buttons[(from + move + buttons.length) % buttons.length]?.focus();
			}}
		>
			{items.map((item) => (
				<button
					key={item.label}
					type="button"
					role="menuitem"
					onClick={() => {
						onClose();
						item.onSelect();
					}}
					className="flex h-9 items-center gap-2.5 px-3 text-left text-sm hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
				>
					<PixelIcon name={item.icon} />
					{item.label}
				</button>
			))}
		</div>,
		document.body,
	);
}
