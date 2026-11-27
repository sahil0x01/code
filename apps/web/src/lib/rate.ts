const WINDOW_MS = 60_000;
const PER_WINDOW = 10;
const recent = new Map<string, number[]>();

// Each test makes the server call an outside address. Counted per server process.
export function allowModelCheck(userId: string, now = Date.now()) {
	const times = (recent.get(userId) ?? []).filter((time) => now - time < WINDOW_MS);
	const allowed = times.length < PER_WINDOW;
	if (allowed) times.push(now);
	recent.set(userId, times);
	return allowed;
}
