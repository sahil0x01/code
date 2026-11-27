"use client";

import { useState, useTransition } from "react";
import { retitleChat } from "@/actions/chats";
import { MAX_TITLE_LENGTH } from "@/lib/chat";

/** A sidebar row while its chat is being renamed: Enter saves, Escape or leaving cancels. */
export function RenameChatField({ chatId, title, onDone }: { chatId: string; title: string; onDone(): void }) {
	const [name, setName] = useState(title);
	const [error, setError] = useState<string | null>(null);
	const [pending, startTransition] = useTransition();

	return (
		<form
			className="flex flex-col gap-1 border-l-2 border-accent bg-surface-2 px-2 py-1"
			onSubmit={(event) => {
				event.preventDefault();
				const data = new FormData(event.currentTarget);
				startTransition(async () => {
					const result = await retitleChat({ status: "idle" }, data);
					if (result.status === "error") setError(result.message);
					else onDone();
				});
			}}
		>
			<input type="hidden" name="chatId" value={chatId} />
			<input
				name="title"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onDone();
				}}
				onFocus={(event) => event.target.select()}
				onBlur={() => {
					if (!pending) onDone();
				}}
				autoFocus
				required
				readOnly={pending}
				maxLength={MAX_TITLE_LENGTH}
				aria-label="Chat name"
				autoComplete="off"
				className="w-full min-w-0 bg-background px-1 py-0.5 text-sm outline-2 outline-ink outline-dashed"
			/>
			{error && (
				<p role="alert" className="text-xs text-red">
					{error}
				</p>
			)}
		</form>
	);
}
