"use client";

import type { RunLive } from "@nullfuse/db";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * What the model is writing right now. The last piece is kept after the stream clears it,
 * until the saved step reaches the page, so nothing blinks out in between.
 */
export function useLive(chatId: string, runId: string, running: boolean) {
	const [live, setLive] = useState<RunLive | null>(null);
	const router = useRouter();

	useEffect(() => {
		if (!running) return;
		const source = new EventSource(`/api/chats/${chatId}/runs/${runId}/live`);
		let step: number | null = null;
		source.addEventListener("live", (event) => {
			try {
				const next = JSON.parse(event.data) as RunLive | null;
				// A step just ended: fetch it now rather than at the next page refresh.
				if (step !== null && next?.stepIndex !== step) router.refresh();
				step = next?.stepIndex ?? null;
				if (next) setLive(next);
			} catch {}
		});
		source.addEventListener("done", () => {
			source.close();
			router.refresh();
		});
		return () => source.close();
	}, [chatId, runId, running, router]);

	return running ? live : null;
}
