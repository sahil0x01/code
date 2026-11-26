"use client";

import { useActionState, useState } from "react";
import { type ChatState, sendMessage } from "@/actions/chats";
import { buttonClass, field } from "@/components/ui/styles";
import { MAX_MESSAGE_LENGTH, MODELS } from "@/lib/chat";

type Props = { chatId: string; defaultModel: string };

const initialState: ChatState = { status: "idle" };

export function MessageForm({ chatId, defaultModel }: Props) {
	const [content, setContent] = useState("");
	const [model, setModel] = useState(defaultModel);

	const [state, formAction, pending] = useActionState(
		async (previous: ChatState, formData: FormData) => {
			const result = await sendMessage(previous, formData);
			if (result.status === "success") setContent("");
			return result;
		},
		initialState,
	);

	return (
		<form action={formAction} className="flex flex-col gap-2">
			<input type="hidden" name="chatId" value={chatId} />

			<div className="pixel-inset flex flex-col bg-surface focus-within:bg-background focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-ink focus-within:outline-dashed">
				<textarea
					name="content"
					value={content}
					onChange={(event) => setContent(event.target.value)}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					required
					maxLength={MAX_MESSAGE_LENGTH}
					rows={3}
					aria-label="Message"
					placeholder="Reply to the agent. If it is still working, your message waits its turn."
					className="min-h-20 resize-y bg-transparent p-4 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
				/>

				<div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
					<select
						name="model"
						value={model}
						onChange={(event) => setModel(event.target.value)}
						aria-label="Model"
						className={field}
					>
						{MODELS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label} ({option.hint})
							</option>
						))}
					</select>

<label className="flex items-center gap-2 text-sm text-muted">
						<input type="checkbox" name="verify" className="size-4 accent-ink" />
						Run tests after
					</label>

					<span className="ml-auto hidden font-mono text-xs text-subtle sm:inline">
						Cmd or Ctrl + Enter
					</span>
					<button
						type="submit"
						disabled={pending || content.trim() === ""}
						className={buttonClass()}
					>
						{pending ? "Sending..." : "Send"}
					</button>
				</div>
			</div>

			{state.status === "error" && (
				<p role="alert" className="text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}
