import type { ReactNode } from "react";

const sides = {
	center: "left-1/2 -translate-x-1/2",
	start: "left-0",
	end: "right-0",
} as const;

/**
 * A hint shown above a control on hover or keyboard focus. The control keeps its own
 * accessible name, so the hint is hidden from screen readers.
 */
export function Tooltip({
	hint,
	align = "center",
	below = false,
	children,
}: {
	hint: string;
	/** Which edge lines up with the control, to stay on screen near the sides. */
	align?: keyof typeof sides;
	/** For controls at the top of the screen, where there is no room above. */
	below?: boolean;
	children: ReactNode;
}) {
	return (
		<span className="group/tip relative inline-flex min-w-0">
			{children}
			<span
				aria-hidden="true"
				className={`pixel-flat pointer-events-none invisible absolute z-40 w-max max-w-60 translate-y-1 bg-ink px-2 py-1 text-left font-mono text-xs text-background opacity-0 transition-[opacity,translate,visibility] duration-150 group-hover/tip:visible group-hover/tip:translate-y-0 group-hover/tip:opacity-100 group-hover/tip:delay-200 group-has-[:focus-visible]/tip:visible group-has-[:focus-visible]/tip:translate-y-0 group-has-[:focus-visible]/tip:opacity-100 ${below ? "top-full mt-2.5" : "bottom-full mb-2.5"} ${sides[align]}`}
			>
				{hint}
			</span>
		</span>
	);
}
