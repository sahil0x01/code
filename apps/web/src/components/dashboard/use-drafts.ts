"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { commentKey, type DraftComment } from "@/lib/review";

const listeners = new Set<() => void>();
// Keeps drafts for this tab when the browser refuses storage.
const memory = new Map<string, string>();

function read(key: string) {
	try {
		return localStorage.getItem(key) ?? memory.get(key) ?? "[]";
	} catch {
		return memory.get(key) ?? "[]";
	}
}

function write(key: string, drafts: DraftComment[]) {
	const value = JSON.stringify(drafts);
	memory.set(key, value);
	try {
		localStorage.setItem(key, value);
	} catch {}
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	window.addEventListener("storage", listener);
	return () => {
		listeners.delete(listener);
		window.removeEventListener("storage", listener);
	};
}

function parse(value: string): DraftComment[] {
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as DraftComment[]) : [];
	} catch {
		return [];
	}
}

export function useDrafts(chatId: string) {
	const key = `review:${chatId}`;
	const value = useSyncExternalStore(
		subscribe,
		() => read(key),
		() => "[]",
	);
	const drafts = useMemo(() => parse(value), [value]);

	const save = useCallback(
		(draft: DraftComment) => {
			const others = parse(read(key)).filter((other) => commentKey(other) !== commentKey(draft));
			write(key, [...others, draft]);
		},
		[key],
	);
	const remove = useCallback(
		(draft: DraftComment) => {
			write(
				key,
				parse(read(key)).filter((other) => commentKey(other) !== commentKey(draft)),
			);
		},
		[key],
	);
	const clear = useCallback(() => write(key, []), [key]);

	return { drafts, save, remove, clear };
}
