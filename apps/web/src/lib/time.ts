const DAY = 86_400_000;

const units = [
	["day", DAY],
	["hour", 3_600_000],
	["minute", 60_000],
] as const;

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// "3 hours ago", "yesterday", or a short date after a month. Meant for server
// components: the result depends on the current time, so do not render it in a
// client component that is also server-rendered (the two clocks would differ).
export function relativeTime(date: Date, now = Date.now()) {
	const diff = date.getTime() - now;

	if (Math.abs(diff) >= 30 * DAY) {
		return date.toLocaleDateString("en", { month: "short", day: "numeric" });
	}
	for (const [unit, size] of units) {
		if (Math.abs(diff) >= size) {
			return relative.format(Math.round(diff / size), unit);
		}
	}
	return "just now";
}
