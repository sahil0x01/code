// Drawn row by row on a 12 by 12 grid, so each icon stays sharp. A # is a filled pixel.
const icons = {
	plan: ["", " ## #######", " ## #######", "", " ## #####", " ## #####", "", " ## #######", " ## #######"],
	tests: [
		"   ######",
		"    #  #",
		"    #  #",
		"    #  #",
		"   #    #",
		"   #    #",
		"  # #### #",
		"  ########",
		" ##########",
		" ##########",
	],
	video: ["", "", " #######", " ####### #", " #########", " #########", " #########", " ####### #", " #######"],
	send: ["", "     ##", "    ####", "   ######", "  ## ## ##", "     ##", "     ##", "     ##", "     ##", "     ##"],
	stop: ["", "", "  ########", "  ########", "  ########", "  ########", "  ########", "  ########", "  ########", "  ########"],
	model: [
		"   #  #",
		"  ########",
		" ##      ##",
		"  # #### #",
		"  # #### #",
		" ## #### ##",
		"  # #### #",
		"  #      #",
		"  ########",
		"   #  #",
	],
	think: [
		"    ####",
		"   #    #",
		"  #  ##  #",
		"  # #    #",
		"  #      #",
		"   #    #",
		"    ####",
		"    ####",
		"",
		"    ####",
	],
	project: ["", " ####", " #   #####", " #########", " #       #", " #       #", " #       #", " #       #", " #########"],
	branch: [
		"  ##",
		"  ##   ##",
		"  #    ##",
		"  #    #",
		"  #   #",
		"  ####",
		"  #",
		"  #",
		"  ##",
		"  ##",
	],
	rename: [
		"        ##",
		"       ####",
		"      ## ###",
		"     ##   #",
		"    ##   ##",
		"   ##   ##",
		"  ##   ##",
		" ##   ##",
		" #   ##",
		" #####",
	],
	attach: [
		"      ###",
		"     #   #",
		"    #  # #",
		"   #  #  #",
		"  #  #  #",
		" #  #  #",
		" #    #",
		" #   #",
		"  ###",
	],
	issue: [
		"    ####",
		"  ##    ##",
		"  #      #",
		" #   ##   #",
		" #  ####  #",
		" #  ####  #",
		" #   ##   #",
		"  #      #",
		"  ##    ##",
		"    ####",
	],
} as const;

export type IconName = keyof typeof icons;

const paths = Object.fromEntries(
	Object.entries(icons).map(([name, rows]) => [
		name,
		rows
			.flatMap((row, y) =>
				[...row.matchAll(/#+/g)].map((run) => `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`),
			)
			.join(""),
	]),
) as Record<IconName, string>;

export function PixelIcon({ name, className = "size-3.5" }: { name: IconName; className?: string }) {
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 12 12"
			shapeRendering="crispEdges"
			fill="currentColor"
			className={`shrink-0 ${className}`}
		>
			<path d={paths[name]} />
		</svg>
	);
}
