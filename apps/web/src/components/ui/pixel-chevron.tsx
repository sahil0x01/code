const rows = [2, 3, 4, 5, 5, 4, 3, 2];

/** The fold marker, drawn on an 8 by 8 pixel grid. Turns down when open. */
export function PixelChevron({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 8 8"
			shapeRendering="crispEdges"
			className={`size-2 shrink-0 fill-current transition-transform duration-150 ease-[steps(3)] ${open ? "rotate-90" : ""}`}
		>
			{rows.map((x, y) => (
				<rect key={y} x={x - 1} y={y} width={3} height={1} />
			))}
		</svg>
	);
}
