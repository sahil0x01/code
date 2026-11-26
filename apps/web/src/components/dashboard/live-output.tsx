"use client";

import type { RunLive } from "@nullfuse/db";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function Thinking({ text }: { text: string }) {
	const box = useRef<HTMLParagraphElement>(null);
	// Follows the newest line.
	useEffect(() => {
		if (box.current && text) box.current.scrollTop = box.current.scrollHeight;
	}, [text]);

	return (
		<div className="flex flex-col gap-1">
			<p className="animate-pulse font-mono text-xs text-subtle">Thinking...</p>
			<p
				ref={box}
				className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 text-sm text-muted"
			>
				{text}
			</p>
		</div>
	);
}

/** What the model is writing right now, for the step that has not finished. */
export function LiveOutput({ chatId, runId }: { chatId: string; runId: string }) {
	const [live, setLive] = useState<RunLive | null>(null);
	const router = useRouter();

	useEffect(() => {
		const source = new EventSource(`/api/chats/${chatId}/runs/${runId}/live`);
		source.addEventListener("live", (event) => {
			try {
				setLive(JSON.parse(event.data) as RunLive | null);
			} catch {}
		});
		source.addEventListener("done", () => {
			source.close();
			setLive(null);
			router.refresh();
		});
		return () => source.close();
	}, [chatId, runId, router]);

	if (!live) return null;
	return (
		<div className="flex flex-col gap-2">
			{live.reasoning && <Thinking text={live.reasoning} />}
			{live.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{live.text}</p>}
			{live.tool && (
				<p className="animate-pulse font-mono text-xs text-muted">Preparing {live.tool}...</p>
			)}
		</div>
	);
}
