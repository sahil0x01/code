"use client";

import { useActionState, useState } from "react";
import { type ChatState, removeChat } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";

const initialState: ChatState = { status: "idle" };

export function DeleteChatButton({ chatId }: { chatId: string }) {
	const [state, formAction, pending] = useActionState(removeChat, initialState);
	const [confirming, setConfirming] = useState(false);

	if (!confirming) {
		return (
			<button
				type="button"
				onClick={() => setConfirming(true)}
				className={buttonClass("secondary", "sm")}
			>
				Delete chat
			</button>
		);
	}

	return (
		<form action={formAction} className="flex flex-wrap items-center gap-2">
			<input type="hidden" name="chatId" value={chatId} />
			<span className="text-sm">Delete this chat and its messages?</span>
			<button
				type="submit"
				disabled={pending}
				className={buttonClass("danger", "sm")}
			>
				{pending ? "Deleting..." : "Delete"}
			</button>
			<button
				type="button"
				onClick={() => setConfirming(false)}
				disabled={pending}
				className={buttonClass("secondary", "sm")}
			>
				Keep
			</button>
			{state.status === "error" && (
				<p role="alert" className="w-full text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}
