"use client";

import { useState } from "react";
import { Disclosure } from "@/components/ui/disclosure";
import { buttonClass } from "@/components/ui/styles";
import type { CommentsResponse, PullComment } from "@nullfuse/connectors/pulls/comments";

type Props = {
	chatId: string;
	disabled: boolean;
	onSend(picked: { key: string; updatedAt: string }[]): void;
};

/** The pull request's comments, to read and then hand to the agent. */
export function PullComments({ chatId, disabled, onSend }: Props) {
	const [comments, setComments] = useState<PullComment[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [left, setLeft] = useState<Set<string>>(new Set());

	const load = async () => {
		setError(null);
		try {
			const response = await fetch(`/api/chats/${chatId}/pr/comments`, { cache: "no-store" });
			const body = (await response.json()) as CommentsResponse | { error: string };
			if ("error" in body) setError(body.error);
			else setComments(body.comments);
		} catch {
			setError("Couldn't load the comments.");
		}
	};
	const picked = comments?.filter((comment) => !left.has(comment.key)) ?? [];

	return (
		// Read again each time it is opened, so new comments show.
		<Disclosure onOpen={load} summaryClass="font-mono text-xs" summary="Comments">
			<div className="flex flex-col gap-2 pt-2">
				{error && (
					<p role="alert" className="text-sm text-red">
						{error}
					</p>
				)}
				{!error && comments === null && <p className="text-sm text-muted">Loading...</p>}
				{comments?.length === 0 && <p className="text-sm text-muted">No comments from people yet.</p>}
				{comments && comments.length > 0 && (
					<>
						<ul className="relative flex max-h-64 flex-col gap-2 overflow-y-auto">
							{comments.map((comment) => (
								<li key={comment.key} className="flex gap-2 border border-border p-2">
									<input
										type="checkbox"
										aria-label={`Include the comment by ${comment.author}`}
										checked={!left.has(comment.key)}
										onChange={() => {
											const next = new Set(left);
											if (!next.delete(comment.key)) next.add(comment.key);
											setLeft(next);
										}}
										className="mt-1 size-3.5 shrink-0 accent-ink"
									/>
									<div className="min-w-0 flex-1">
										<p className="font-mono text-xs text-subtle">
											<a href={comment.url} target="_blank" rel="noreferrer" className="underline">
												{comment.author}
											</a>
											{comment.where && ` · ${comment.where}`}
										</p>
										<p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
									</div>
								</li>
							))}
						</ul>
						<button
							type="button"
							disabled={disabled || picked.length === 0}
							onClick={() => onSend(picked.map(({ key, updatedAt }) => ({ key, updatedAt })))}
							className={`${buttonClass("secondary", "sm")} w-fit`}
						>
							Send {picked.length} to the agent
						</button>
					</>
				)}
			</div>
		</Disclosure>
	);
}
