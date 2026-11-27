const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");

/** 1,284 below ten thousand, then 12.9K, 4.2M. */
export function formatCount(value: number) {
	return Math.abs(value) < 10_000 ? whole.format(Math.round(value)) : compact.format(value);
}

export function formatPercent(rate: number | null) {
	return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Seconds as "45m" or "12.5h". */
export function formatHours(seconds: number) {
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	const hours = seconds / 3600;
	return `${hours < 100 ? hours.toFixed(1) : formatCount(Math.round(hours))}h`;
}

/** Millionths of a dollar as "$0.42" or "$12.3K". */
export function formatMicroDollars(micro: number) {
	const dollars = micro / 1_000_000;
	return dollars >= 10_000 ? `$${compact.format(dollars)}` : `$${dollars.toFixed(2)}`;
}

/** `YYYY-MM-DD` as "Nov 27". */
export function formatDay(day: string) {
	return new Date(`${day}T00:00:00Z`).toLocaleDateString("en", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}
