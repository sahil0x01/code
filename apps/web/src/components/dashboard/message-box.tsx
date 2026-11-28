"use client";

import { type ComponentProps, useEffect, useId, useMemo, useRef, useState } from "react";
import type { FileList } from "@/lib/file-source";
import { activeToken, applySuggestion, type Suggestion, suggestCommands, suggestFiles } from "@/lib/suggest";

type Props = Omit<ComponentProps<"textarea">, "value" | "onChange"> & {
	value: string;
	onChange(value: string): void;
	projectId: string;
	/** Whose files `@` suggests. */
	branch: string;
	/** Where the list opens, so it stays on screen. */
	listPlacement: "above" | "below";
};

const none: FileList = { files: [], skills: [], partial: false };

function useFiles(projectId: string, branch: string, wanted: boolean) {
	const url = `/api/projects/${projectId}/files?branch=${encodeURIComponent(branch)}`;
	const [loaded, setLoaded] = useState<{ url: string; list: FileList; failed: boolean }>();

	useEffect(() => {
		if (!wanted) return;
		const stop = new AbortController();
		// A pause, so typing a branch name does not ask once for every letter.
		const wait = setTimeout(async () => {
			try {
				const response = await fetch(url, { signal: stop.signal });
				if (!response.ok) throw new Error("not listed");
				setLoaded({ url, list: await response.json(), failed: false });
			} catch {
				if (!stop.signal.aborted) setLoaded({ url, list: none, failed: true });
			}
		}, 150);
		return () => {
			clearTimeout(wait);
			stop.abort();
		};
	}, [url, wanted]);

	return loaded?.url === url ? loaded : undefined;
}

/** A message textarea that suggests commands after `/` and files after `@`. */
export function MessageBox({ value, onChange, projectId, branch, listPlacement, onKeyDown, ...textarea }: Props) {
	const box = useRef<HTMLTextAreaElement>(null);
	const listId = useId();
	const [caret, setCaret] = useState(0);
	const [focused, setFocused] = useState(false);
	const [dismissed, setDismissed] = useState<number | null>(null);
	const [picked, setPicked] = useState({ key: "", index: 0 });

	const token = focused ? activeToken(value, Math.min(caret, value.length)) : null;
	const loaded = useFiles(projectId, branch, token !== null);
	const options: Suggestion[] = useMemo(() => {
		if (!token) return [];
		return token.kind === "command"
			? suggestCommands(loaded?.list.skills ?? [], token.query)
			: suggestFiles(loaded?.list.files ?? [], token.query);
	}, [token?.kind, token?.query, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

	const open = token !== null && dismissed !== token.start;
	const key = token ? `${token.kind}:${token.query}` : "";
	const index = picked.key === key ? Math.min(picked.index, Math.max(0, options.length - 1)) : 0;
	const note =
		token?.kind !== "file" || options.length > 0
			? null
			: !loaded
				? "Loading files..."
				: loaded.failed
					? "The files could not be listed. You can still type the path."
					: "No file matches.";

	const choose = (option: Suggestion) => {
		if (!token) return;
		const next = applySuggestion(value, token, caret, option.value);
		onChange(next.text);
		setCaret(next.caret);
		requestAnimationFrame(() => {
			box.current?.focus();
			box.current?.setSelectionRange(next.caret, next.caret);
		});
	};

	return (
		<div className="relative flex flex-col">
			<textarea
				{...textarea}
				ref={box}
				value={value}
				aria-autocomplete="list"
				aria-controls={open ? listId : undefined}
				aria-activedescendant={open && options.length > 0 ? `${listId}-${index}` : undefined}
				onChange={(event) => {
					onChange(event.target.value);
					setCaret(event.target.selectionStart);
					setDismissed(null);
				}}
				onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				onKeyDown={(event) => {
					if (open && options.length > 0 && !event.nativeEvent.isComposing) {
						const move = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
						if (move !== 0) {
							event.preventDefault();
							setPicked({ key, index: (index + move + options.length) % options.length });
							return;
						}
						const option = options[index];
						const accepts = event.key === "Tab" || event.key === "Enter";
						// A word already typed in full is left alone, so Enter still sends it.
						const complete = option?.value.slice(1) === token?.query;
						if (option && accepts && !event.shiftKey && !event.metaKey && !event.ctrlKey && !complete) {
							event.preventDefault();
							choose(option);
							return;
						}
					}
					if (open && event.key === "Escape") {
						event.preventDefault();
						setDismissed(token.start);
						return;
					}
					onKeyDown?.(event);
				}}
			/>
			{open && (options.length > 0 || note) && (
				<div
					className={`pixel-inset absolute left-2 z-20 flex max-h-64 w-[min(34rem,calc(100%-1rem))] flex-col overflow-y-auto overscroll-contain bg-background py-1 ${
						listPlacement === "above" ? "bottom-full mb-1" : "top-full mt-1"
					}`}
				>
					{note ? (
						<p className="px-3 py-1.5 text-xs text-muted">{note}</p>
					) : (
						<div id={listId} role="listbox" aria-label={token.kind === "command" ? "Commands" : "Files"}>
							{options.map((option, at) => (
								<div
									key={option.value}
									id={`${listId}-${at}`}
									role="option"
									tabIndex={-1}
									aria-selected={at === index}
									// Keeps the caret in the textarea while choosing.
									onMouseDown={(event) => {
										event.preventDefault();
										choose(option);
									}}
									onMouseEnter={() => setPicked({ key, index: at })}
									className={`flex cursor-pointer items-baseline gap-3 px-3 py-1.5 ${at === index ? "bg-surface-2" : ""}`}
								>
									<span className="min-w-0 shrink-0 max-w-full truncate font-mono text-xs">{option.value}</span>
									<span className="truncate text-xs text-muted">{option.hint}</span>
								</div>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
