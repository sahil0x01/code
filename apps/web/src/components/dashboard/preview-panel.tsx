"use client";

import { useCallback, useEffect, useState } from "react";
import { closePreview, wakePreview } from "@/actions/preview";
import { buttonClass } from "@/components/ui/styles";
import type { PreviewView } from "@/lib/preview";

const POLL_MS = 3_000;
const IDLE_POLL_MS = 20_000;

/** Resolves to why it could not be woken, or null. */
const wake = (chatId: string) =>
	wakePreview(chatId).then(
		(result) => (result.ok ? null : result.message),
		() => "Something went wrong. Try again.",
	);

/** Wakes the preview when opened, and keeps it awake for as long as the page stays open. */
export function PreviewPanel({ chatId }: { chatId: string }) {
	const [view, setView] = useState<PreviewView | null>(null);
	const [problem, setProblem] = useState<string | null>(null);
	// Goes up each time the preview is started, which restarts the polling.
	const [started, setStarted] = useState(0);

	const woken = useCallback((message: string | null) => {
		setProblem(message);
		setStarted((value) => value + 1);
	}, []);

	useEffect(() => {
		wake(chatId).then(woken);
	}, [chatId, woken]);

	useEffect(() => {
		if (started === 0) return;
		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout>;
		const load = async () => {
			let next = IDLE_POLL_MS;
			try {
				const response = await fetch(`/api/chats/${chatId}/preview`, { signal: abort.signal, cache: "no-store" });
				if (response.ok) {
					const body: PreviewView = await response.json();
					setView(body);
					if (body.status === "starting") next = POLL_MS;
				}
			} catch {
				if (abort.signal.aborted) return;
			}
			if (!abort.signal.aborted) timer = setTimeout(load, next);
		};
		load();
		return () => {
			abort.abort();
			clearTimeout(timer);
		};
	}, [chatId, started]);

	const status = view?.status ?? "starting";
	const ended = problem !== null || status === "stopped" || status === "failed" || status === "none";

	return (
		<div aria-live="polite" className="pixel-inset flex flex-col items-start gap-3 bg-surface p-5">
			{problem ? (
				<p role="alert" className="text-sm text-red">
					{problem}
				</p>
			) : status === "starting" ? (
				<p className="text-sm text-muted">Starting the app from this chat&apos;s branch. This can take a few minutes.</p>
			) : view?.url ? (
				<>
					<p className="text-sm">The preview is ready.</p>
					<a href={view.url} target="_blank" rel="noreferrer" className={buttonClass()}>
						Open preview ↗
					</a>
					<p className="text-sm text-muted">
						It stays up while this page is open
						{view.expiresAt && `, until ${new Date(view.expiresAt).toLocaleTimeString()} at the latest`}. Anyone you
						send the preview address to can open it until then. The sandbox provider may show a warning first.
					</p>
					<button
						type="button"
						onClick={async () => {
							await closePreview(chatId);
							setStarted((value) => value + 1);
						}}
						className={buttonClass("secondary", "sm")}
					>
						Stop preview
					</button>
				</>
			) : status === "failed" ? (
				<pre className="max-w-full overflow-x-auto whitespace-pre-wrap font-mono text-xs text-red">{view?.error}</pre>
			) : (
				<p className="text-sm text-muted">The preview is stopped.</p>
			)}
			{ended && (
				<button
					type="button"
					onClick={() => {
						setProblem(null);
						setView(null);
						wake(chatId).then(woken);
					}}
					className={buttonClass("primary", "sm")}>
					Start preview
				</button>
			)}
		</div>
	);
}
