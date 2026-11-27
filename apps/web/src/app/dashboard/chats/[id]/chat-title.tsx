"use client";

import { useActionState, useState } from "react";
import { type ChatState, retitleChat } from "@/actions/chats";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { buttonClass, field } from "@/components/ui/styles";
import { Tooltip } from "@/components/ui/tooltip";
import { MAX_TITLE_LENGTH } from "@/lib/chat";

const idle: ChatState = { status: "idle" };

/** The chat's name, which can be changed in place. Give it the title as its key. */
export function ChatTitle({ chatId, title }: { chatId: string; title: string }) {
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(title);
	const [state, formAction, pending] = useActionState(async (previous: ChatState, formData: FormData) => {
		const result = await retitleChat(previous, formData);
		if (result.status === "success") setEditing(false);
		return result;
	}, idle);

	const stop = () => {
		setName(title);
		setEditing(false);
	};

	if (!editing) {
		return (
			<div className="flex min-w-0 items-center gap-2">
				<h1 className="truncate text-sm font-semibold" title={title}>
					{title}
				</h1>
				<Tooltip hint="Rename chat" below>
					<button
						type="button"
						onClick={() => setEditing(true)}
						aria-label="Rename chat"
						className="inline-flex size-6 shrink-0 items-center justify-center text-muted hover:bg-surface-2 hover:text-foreground"
					>
						<PixelIcon name="rename" />
					</button>
				</Tooltip>
			</div>
		);
	}

	return (
		<form action={formAction} className="flex flex-wrap items-center gap-2 py-1">
			<input type="hidden" name="chatId" value={chatId} />
			<input
				name="title"
				value={name}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") stop();
				}}
				onFocus={(event) => event.target.select()}
				autoFocus
				required
				maxLength={MAX_TITLE_LENGTH}
				aria-label="Chat name"
				autoComplete="off"
				className={`${field} h-8 min-w-0 flex-1`}
			/>
			<button type="submit" disabled={pending || name.trim() === ""} className={buttonClass("primary", "sm")}>
				{pending ? "Saving..." : "Save"}
			</button>
			<button type="button" onClick={stop} className={buttonClass("secondary", "sm")}>
				Cancel
			</button>
			{state.status === "error" && (
				<p role="alert" className="w-full text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}
