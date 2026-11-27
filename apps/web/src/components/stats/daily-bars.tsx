import { formatDay } from "@/lib/format-stats";

type Point = { day: string; value: number };

/**
 * One series of daily bars. Hover or focus a bar for its day and value; the same numbers
 * are in the table under "Show as table".
 */
export function DailyBars({
	title,
	points,
	format,
	unit,
}: {
	title: string;
	points: Point[];
	format: (value: number) => string;
	/** The table's column heading and the word after each value, as in "12 runs". */
	unit: string;
}) {
	const max = Math.max(0, ...points.map((point) => point.value));
	const first = points[0];
	const last = points.at(-1);

	return (
		<figure className="pixel-inset flex flex-col gap-3 bg-surface p-4">
			<figcaption className="flex items-baseline justify-between gap-3">
				<span className="text-sm font-medium">{title}</span>
				<span className="font-mono text-xs text-subtle">peak {format(max)}</span>
			</figcaption>

			{max === 0 ? (
				<p className="flex h-32 items-center justify-center text-sm text-subtle">Nothing yet.</p>
			) : (
				<div className="flex flex-col gap-1.5">
					<div className="flex h-32 items-end gap-0.5 border-b border-border">
						{points.map((point, index) => {
							const label = `${formatDay(point.day)}: ${format(point.value)} ${unit}`;
							// Tooltips near the edges line up with that edge so they stay on screen.
							const align =
								index < points.length / 4
									? "left-0"
									: index >= (points.length * 3) / 4
										? "right-0"
										: "left-1/2 -translate-x-1/2";
							return (
								<div
									key={point.day}
									// Focusable so keyboard users get the same tooltip.
									tabIndex={0}
									role="img"
									aria-label={label}
									className="group/bar relative flex h-full min-w-0 flex-1 items-end outline-none"
								>
									<div
										className="w-full rounded-t-[4px] bg-blue group-hover/bar:opacity-75 group-focus-visible/bar:opacity-75"
										style={{ height: point.value > 0 ? `max(2px, ${(point.value / max) * 100}%)` : 0 }}
									/>
									<span
										aria-hidden="true"
										className={`pixel-flat pointer-events-none invisible absolute bottom-full z-10 mb-1.5 w-max bg-ink px-2 py-1 font-mono text-xs text-background group-hover/bar:visible group-focus-visible/bar:visible ${align}`}
									>
										{label}
									</span>
								</div>
							);
						})}
					</div>
					<div className="flex justify-between font-mono text-xs text-subtle">
						<span>{first && formatDay(first.day)}</span>
						<span>{last && formatDay(last.day)}</span>
					</div>
				</div>
			)}

			<details className="text-sm">
				<summary className="w-fit cursor-pointer text-xs text-muted hover:text-foreground">
					Show as table
				</summary>
				<table className="mt-2 w-full font-mono text-xs">
					<thead>
						<tr className="text-left text-subtle">
							<th className="py-1 font-normal">Day</th>
							<th className="py-1 text-right font-normal capitalize">{unit}</th>
						</tr>
					</thead>
					<tbody>
						{points.map((point) => (
							<tr key={point.day} className="border-t border-border">
								<td className="py-1">{formatDay(point.day)}</td>
								<td className="py-1 text-right tabular-nums">{format(point.value)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</details>
		</figure>
	);
}
