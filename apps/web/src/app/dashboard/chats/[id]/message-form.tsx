"use client";

import { useActionState, useState } from "react";
import { type ChatState, sendMessage, stopRun } from "@/actions/chats";
import {
	IconButton,
	ModelPicker,
	ReasoningPicker,
	RunToggles,
} from "@/components/dashboard/composer-controls";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat";

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

					<div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-2 pb-2.5">
						<ModelPicker value={model} onChange={setModel} />
						<ReasoningPicker value={reasoning} onChange={setReasoning} />
						<RunToggles canRecord={canRecord} />

						<span className="ml-auto flex gap-3">
							{running && (
								<IconButton
									type="submit"
									form={STOP_FORM}
									disabled={running.stopping}
									icon="stop"
									tone="secondary"
									label={running.stopping ? "Stopping" : "Stop"}
									hint={running.stopping ? "Stopping..." : "Stop the run"}
								/>
							)}
							<IconButton
								type="submit"
								disabled={pending || content.trim() === ""}
								icon="send"
								label={pending ? "Sending" : "Send"}
								hint="Send: Enter. New line: Shift + Enter"
							/>
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
