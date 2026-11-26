"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-renders the page's server components every few seconds while a run is
// going. Client state (what you are typing, scroll position) is kept.
export function AutoRefresh({ active, intervalMs = 2000 }: { active: boolean; intervalMs?: number }) {
	const router = useRouter();

	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => {
			if (document.visibilityState === "visible") router.refresh();
		}, intervalMs);
		return () => clearInterval(timer);
	}, [active, intervalMs, router]);

	return null;
}
