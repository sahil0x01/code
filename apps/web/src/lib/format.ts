export function formatTokens(count: number) {
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/** From millionths of a dollar. Runs often cost less than a cent. */
export function formatCost(micro: number) {
	if (micro < 1000) return "<$0.001";
	const dollars = micro / 1_000_000;
	return `$${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}
