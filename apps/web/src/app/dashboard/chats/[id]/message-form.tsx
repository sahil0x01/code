"use client";

import { useActionState, useState } from "react";
import { type ChatState, sendMessage, stopRun } from "@/actions/chats";
import { buttonClass } from "@/components/ui/styles";
import { MAX_MESSAGE_LENGTH, MODELS, REASONING_OPTIONS } from "@/lib/chat";

type Props = {
	chatId: string;
	defaultModel: string;
	defaultReasoning: string;
	/** The run working right now, which can be stopped from here. */
	running?: { id: string; stopping: boolean };
	/** The project says how to start its app, so a run can record it. */
	canRecord: boolean;
};

const initialState: ChatState = { status: "idle" };
const STOP_FORM = "stop-run";

export function MessageForm({
	chatId,
	defaultModel,
	defaultReasoning,
	running,
	canRecord,
}: Props) {
	const [reasoning, setReasoning] = useState(defaultReasoning);
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
		<>
			{running && (
				<form id={STOP_FORM} action={stopRun}>
					<input type="hidden" name="runId" value={running.id} />
				</form>
			)}
			<form action={formAction} className="flex flex-col gap-2">
				<input type="hidden" name="chatId" value={chatId} />

				<div className="pixel-inset flex flex-col bg-surface focus-within:bg-background focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-ink focus-within:outline-dashed">
					<textarea
						name="content"
						value={content}
						onChange={(event) => setContent(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
							// On touch keyboards Enter makes a new line; the Send button sends.
							if (window.matchMedia("(pointer: coarse)").matches) return;
							event.preventDefault();
							if (!pending && content.trim() !== "") event.currentTarget.form?.requestSubmit();
						}}
						required
						maxLength={MAX_MESSAGE_LENGTH}
						rows={1}
						aria-label="Message"
						placeholder={running ? "Queue a follow-up..." : "Reply to the agent..."}
						className="field-sizing-content max-h-48 min-h-12 resize-none bg-transparent px-3 py-3 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
					/>

					<div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 pb-3">
						<select
							name="model"
							value={model}
							onChange={(event) => setModel(event.target.value)}
							aria-label="Model"
							className="h-8 bg-transparent font-mono text-xs text-muted hover:text-foreground"
						>
							{MODELS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>

						<select
							name="reasoning"
							value={reasoning}
							onChange={(event) => setReasoning(event.target.value)}
							aria-label="Reasoning level"
							className="h-8 bg-transparent font-mono text-xs text-muted hover:text-foreground"
						>
							{REASONING_OPTIONS.map((option) => (
								<option key={option.id} value={option.id}>
									{option.label}
								</option>
							))}
						</select>

						<label className="flex items-center gap-1.5 font-mono text-xs text-muted">
							<input type="checkbox" name="verify" className="size-3.5 accent-ink" />
							Run tests
						</label>

						{canRecord && (
							<label className="flex items-center gap-1.5 font-mono text-xs text-muted">
								<input type="checkbox" name="record" className="size-3.5 accent-ink" />
								Record video
							</label>
						)}

						<span className="ml-auto hidden font-mono text-xs text-subtle lg:inline">
							Shift + Enter for a new line
						</span>
						<span className="ml-auto flex gap-3 lg:ml-0">
							{running && (
								<button
									type="submit"
									form={STOP_FORM}
									disabled={running.stopping}
									className={buttonClass("secondary", "sm")}
								>
									{running.stopping ? "Stopping..." : "Stop"}
								</button>
							)}
							<button
								type="submit"
								disabled={pending || content.trim() === ""}
								className={buttonClass("primary", "sm")}
							>
								{pending ? "Sending..." : "Send"}
							</button>
						</span>
					</div>
				</div>

				{state.status === "error" && (
					<p role="alert" className="text-sm text-red">
						{state.message}
					</p>
				)}
			</form>
		</>
	);
}
