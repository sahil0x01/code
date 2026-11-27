"use client";

import type { FinishedRun } from "@nullfuse/db";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, Suspense, useCallback, useContext, useEffect, useState } from "react";
import { type InboxResponse, inboxSignature, newlyFinished, notificationText } from "@/lib/notify";

const VISIBLE_MS = 5_000;
// Browsers slow timers in hidden tabs further, so a notification can take about a minute.
const HIDDEN_MS = 15_000;
const MAX_TOASTS = 3;
// The chat stays marked unread, so a toast does not need to wait to be closed.
const TOAST_MS = 10_000;

const NeedsReview = createContext(0);
export const useNeedsReview = () => useContext(NeedsReview);

const chatPath = (chatId: string) => `/dashboard/chats/${chatId}`;

function showBrowserNotification(run: FinishedRun, open: (path: string) => void) {
	if (!("Notification" in window) || Notification.permission !== "granted") return;
	try {
		// The tag keeps several open tabs from showing the same run twice.
		const shown = new Notification(notificationText(run), { body: run.title, tag: run.runId });
		shown.onclick = () => {
			window.focus();
			open(chatPath(run.chatId));
			shown.close();
		};
	} catch {
		// Some mobile browsers only allow notifications from a service worker.
	}
}

/** Watches for finished runs while any dashboard tab is open. */
export function InboxProvider({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const [needsReview, setNeedsReview] = useState(0);
	const [toasts, setToasts] = useState<FinishedRun[]>([]);

	useEffect(() => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		let loading = false;
		// Null until the first answer: what finished before the page opened is not announced.
		let known: Set<string> | null = null;
		let signature = "";

		const check = async () => {
			if (loading || stopped) return;
			loading = true;
			clearTimeout(timer);
			try {
				const response = await fetch("/api/inbox", { cache: "no-store" });
				if (response.status === 401) stopped = true;
				if (!response.ok || stopped) return;
				const inbox: InboxResponse = await response.json();
				setNeedsReview(inbox.needsReview);

				const next = inboxSignature(inbox);
				if (signature && next !== signature) router.refresh();
				signature = next;

				if (known) {
					const fresh = newlyFinished(known, inbox).filter(
						// The user is already looking at this one.
						(run) =>
							!(document.visibilityState === "visible" && location.pathname === chatPath(run.chatId)),
					);
					for (const run of fresh) showBrowserNotification(run, (path) => router.push(path));
					if (fresh.length > 0) setToasts((old) => [...fresh, ...old].slice(0, MAX_TOASTS));
				}
				known = new Set([...(known ?? []), ...inbox.finished.map((run) => run.runId)]);
			} catch {
				// Offline or the server restarted: the next check tries again.
			} finally {
				loading = false;
				if (!stopped) {
					timer = setTimeout(check, document.visibilityState === "visible" ? VISIBLE_MS : HIDDEN_MS);
				}
			}
		};

		const onVisible = () => {
			if (document.visibilityState === "visible") check();
		};
		document.addEventListener("visibilitychange", onVisible);
		check();
		return () => {
			stopped = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [router]);

	const dismiss = useCallback(
		(runId: string) => setToasts((old) => old.filter((run) => run.runId !== runId)),
		[],
	);

	return (
		<NeedsReview value={needsReview}>
			{children}
			<Suspense>
				<Toasts runs={toasts} dismiss={dismiss} />
			</Suspense>
		</NeedsReview>
	);
}

// Reads the current path, so it must sit under a <Suspense> boundary.
function Toasts({ runs, dismiss }: { runs: FinishedRun[]; dismiss(runId: string): void }) {
	const pathname = usePathname();

	return (
		<ul
			aria-live="polite"
			className="fixed right-4 bottom-4 z-50 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2"
		>
			{runs
				.filter((run) => pathname !== chatPath(run.chatId))
				.map((run) => (
					<Toast key={run.runId} run={run} dismiss={dismiss} />
				))}
		</ul>
	);
}

function Toast({ run, dismiss }: { run: FinishedRun; dismiss(runId: string): void }) {
	useEffect(() => {
		const timer = setTimeout(() => dismiss(run.runId), TOAST_MS);
		return () => clearTimeout(timer);
	}, [run.runId, dismiss]);

	return (
		<li className="slide-in pixel-inset flex items-start gap-2 bg-surface p-3">
			<Link
				href={chatPath(run.chatId)}
				onClick={() => dismiss(run.runId)}
				className="flex min-w-0 flex-1 flex-col gap-0.5"
			>
				<span className={`text-sm font-medium ${run.status === "failed" ? "text-red" : "text-green"}`}>
					{notificationText(run)}
				</span>
				<span className="truncate text-sm text-muted">{run.title}</span>
			</Link>
			<button
				type="button"
				onClick={() => dismiss(run.runId)}
				aria-label="Dismiss"
				className="px-1 text-muted hover:text-foreground"
			>
				×
			</button>
		</li>
	);
}
