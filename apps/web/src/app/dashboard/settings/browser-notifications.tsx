"use client";

import { useState, useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui/styles";

type State = NotificationPermission | "unsupported" | "unknown";

const subscribe = () => () => {};
const read = (): State => ("Notification" in window ? Notification.permission : "unsupported");

// The permission belongs to this browser, so it is not saved with the account.
export function BrowserNotifications() {
	const current = useSyncExternalStore<State>(subscribe, read, () => "unknown");
	const [answer, setAnswer] = useState<State>();
	const state = answer ?? current;

	if (state === "unknown") return null;
	if (state === "default") {
		return (
			<button
				type="button"
				onClick={async () => setAnswer(await Notification.requestPermission())}
				className={`${buttonClass("secondary", "sm")} w-fit`}
			>
				Turn on browser notifications
			</button>
		);
	}
	return (
		<p className="text-sm text-muted">
			{state === "granted" && "Browser notifications are on. They arrive while a dashboard tab is open."}
			{state === "denied" &&
				"Browser notifications are blocked. Allow them for this site in your browser's settings."}
			{state === "unsupported" && "This browser does not support notifications."}
		</p>
	);
}
