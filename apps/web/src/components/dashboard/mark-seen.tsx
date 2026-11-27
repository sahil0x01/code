"use client";

import { useEffect } from "react";
import { markSeen } from "@/actions/chats";

/** Marks the chat read once its latest result is on a screen someone can see. */
export function MarkSeen({ chatId, until }: { chatId: string; until: string }) {
	useEffect(() => {
		const mark = () => {
			if (document.visibilityState !== "visible") return;
			document.removeEventListener("visibilitychange", mark);
			markSeen({ chatId, until }).catch(() => {});
		};
		document.addEventListener("visibilitychange", mark);
		mark();
		return () => document.removeEventListener("visibilitychange", mark);
	}, [chatId, until]);

	return null;
}
