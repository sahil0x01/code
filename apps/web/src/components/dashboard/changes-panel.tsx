"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sendMessage } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat";
import type { Diff, DiffResponse } from "@/lib/diff";
import { commentKey, formatReview } from "@/lib/review";
import { DiffFileView } from "./diff-file";
import { useDrafts } from "./use-drafts";

type Props = {
	chatId: string;
	model: string;
	reasoning: string;
	/** Changes whenever the agent may have pushed new work. */
	refreshKey: string;
};

type View = Diff | { state: "loading" | "not_pushed" | "disconnected" };

export function ChangesPanel({ chatId, model, reasoning, refreshKey }: Props) {
	const [view, setView] = useState<View>({ state: "loading" });
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);
	const head = useRef<string | undefined>(undefined);

	useEffect(() => {
		const abort = new AbortController();
		const load = async () => {
			try {
				const query = head.current ? `?head=${head.current}` : "";
				const response = await fetch(`/api/chats/${chatId}/diff${query}`, { signal: abort.signal });
				const body = (await response.json()) as DiffResponse | { error: string };
				if ("error" in body) {
					setError(body.error);
					return;
				}
				setError(null);
				if (body.state === "unchanged") return;
				head.current = body.state === "ok" ? body.headSha : undefined;
				setView(body);
			} catch {
				if (!abort.signal.aborted) setError("Couldn't load the changes. Check your connection.");
			}
		};
		load();
		return () => abort.abort();
	}, [chatId, refreshKey, reload]);

	const { drafts, save, remove, clear } = useDrafts(chatId);
	const [sending, startSending] = useTransition();
	const [sendError, setSendError] = useState<string | null>(null);
	const router = useRouter();

	const files = view.state === "ok" ? view.files : [];
	const review = drafts.length > 0 ? formatReview(drafts, files) : "";
	const tooLong = review.length > MAX_MESSAGE_LENGTH;
	const additions = files.reduce((total, file) => total + file.additions, 0);
	const deletions = files.reduce((total, file) => total + file.deletions, 0);
	const paths = new Set(files.map((file) => file.path));
	const orphans = view.state === "ok" ? drafts.filter((draft) => !paths.has(draft.path)) : [];

	const send = () =>
		startSending(async () => {
			const form = new FormData();
			form.set("chatId", chatId);
			form.set("model", model);
			form.set("reasoning", reasoning);
			form.set("content", review);
			const result = await sendMessage({ status: "idle" }, form).catch(() => ({
				status: "error" as const,
				message: "Something went wrong. Try again.",
			}));
			if (result.status === "error") {
				setSendError(result.message);
				return;
			}
			setSendError(null);
			clear();
			router.refresh();
		});

	return (
		<section aria-label="Changes" className="flex flex-col gap-3 px-1 pt-3 md:px-4">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
				<h2 className="font-semibold">
					Changes
					{view.state === "ok" && ` · ${files.length} ${files.length === 1 ? "file" : "files"}`}
				</h2>
				{view.state === "ok" && (
					<span className="font-mono text-xs">
						<span className="text-green">+{additions}</span>{" "}
						<span className="text-red">−{deletions}</span>
					</span>
				)}
				<span className="ml-auto flex gap-3 font-mono text-xs text-muted">
					<button type="button" onClick={() => setReload(reload + 1)} className="underline hover:text-foreground">
						Refresh
					</button>
					{view.state === "ok" && (
						<a href={view.url} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
							GitHub ↗
						</a>
					)}
				</span>
			</div>

			{error && (
				<p role="alert" className="text-sm text-red">
					{error}
				</p>
			)}
			{view.state === "loading" && !error && <p className="text-sm text-muted">Loading changes...</p>}
			{view.state === "not_pushed" && (
				<p className="text-sm text-muted">
					Changes appear here once the agent saves its first work to the branch.
				</p>
			)}
			{view.state === "disconnected" && (
				<p className="text-sm text-muted">Reconnect the project to see the changes.</p>
			)}
			{view.state === "ok" && files.length === 0 && (
				<p className="text-sm text-muted">The branch has no changes compared with the base branch.</p>
			)}
			{view.state === "ok" && view.truncated && (
				<p role="alert" className="text-sm text-red">
					This change is very large, so the list is incomplete. See the rest on GitHub.
				</p>
			)}

			{view.state === "ok" && (
				<ul className="flex flex-col gap-3 px-0.5">
					{files.map((file) => (
						<DiffFileView
							key={file.path}
							file={file}
							url={view.url}
							drafts={drafts.filter((draft) => draft.path === file.path)}
							onSave={save}
							onRemove={remove}
						/>
					))}
				</ul>
			)}

			{orphans.map((draft) => (
				<p key={commentKey(draft)} className="break-words text-sm text-muted">
					Outdated draft on {draft.path}: {draft.body}{" "}
					<button type="button" onClick={() => remove(draft)} className="underline">
						Delete
					</button>
				</p>
			))}

			{drafts.length > 0 && (
				<div className="sticky bottom-0 flex flex-col items-end gap-2 border-t border-border bg-background py-3">
					{tooLong && (
						<p role="alert" className="text-sm text-red">
							These comments are over the {MAX_MESSAGE_LENGTH.toLocaleString("en")} character limit.
							Shorten or delete some.
						</p>
					)}
					{sendError && (
						<p role="alert" className="text-sm text-red">
							{sendError}
						</p>
					)}
					<button type="button" onClick={send} disabled={sending || tooLong} className={buttonClass()}>
						{sending
							? "Sending..."
							: `Send ${drafts.length} ${drafts.length === 1 ? "comment" : "comments"} to agent`}
					</button>
				</div>
			)}
		</section>
	);
}
