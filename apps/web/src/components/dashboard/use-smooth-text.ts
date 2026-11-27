"use client";

import { useEffect, useState } from "react";
import { nextReveal } from "@/lib/reveal";

/** Reveals text that arrives in chunks a little at a time, once per frame. */
export function useSmoothText(target: string, live: boolean) {
	const [shown, setShown] = useState(live ? "" : target);

	useEffect(() => {
		if (!live || shown === target) return;
		const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		const frame = requestAnimationFrame(() => setShown(still ? target : nextReveal(shown, target)));
		return () => cancelAnimationFrame(frame);
	}, [shown, target, live]);

	return live ? shown : target;
}
