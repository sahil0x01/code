/**
 * The next text to show while catching up with `target`. The step grows with the backlog,
 * so a burst appears quickly and a trickle reads like typing.
 */
export function nextReveal(shown: string, target: string) {
	let at = shown.length;
	if (!target.startsWith(shown)) {
		// The live text keeps only its end, so find where the shown text now sits.
		const tail = shown.slice(-40);
		const found = tail ? target.lastIndexOf(tail) : -1;
		if (found === -1) return target;
		at = found + tail.length;
	}
	const backlog = target.length - at;
	return target.slice(0, at + Math.max(1, Math.ceil(backlog / 12)));
}
