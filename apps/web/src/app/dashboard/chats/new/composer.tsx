"use client";

import { useActionState, useState } from "react";
import { type ChatState, startChat } from "@/actions/chats";
import {
	IconButton,
	ModelPicker,
	type OwnModelOption,
	Picker,
	ReasoningPicker,
	RunToggles,
} from "@/components/dashboard/composer-controls";
import { MessageBox } from "@/components/dashboard/message-box";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { Tooltip } from "@/components/ui/tooltip";
import {
	DEFAULT_MODEL_ID,
	DEFAULT_REASONING,
	MAX_MESSAGE_LENGTH,
} from "@/lib/chat";
import { IssuePicker } from "./issue-picker";

type ProjectOption = {
	id: string;
	fullName: string;
	defaultBranch: string;
};

type Props = {
	projects: ProjectOption[];
	initialProjectId: string;
	ownModels: OwnModelOption[];
};

const initialState: ChatState = { status: "idle" };

export function Composer({ projects, initialProjectId, ownModels }: Props) {
	const [state, formAction, pending] = useActionState(startChat, initialState);

	const [projectId, setProjectId] = useState(initialProjectId);
	const [branch, setBranch] = useState(
		() =>
			projects.find((project) => project.id === initialProjectId)
				?.defaultBranch ?? "main",
	);
	const [model, setModel] = useState<string>(DEFAULT_MODEL_ID);
	const [content, setContent] = useState("");
	const [reasoning, setReasoning] = useState<string>(DEFAULT_REASONING);
	// The issue the message was filled from; the pull request will close it.
	const [issue, setIssue] = useState<{ number: number; message: string } | null>(null);

	return (
		<form action={formAction} className="flex flex-col gap-3">
			<IssuePicker
				key={projectId}
				projectId={projectId}
				onPick={(picked) => {
					// Keeps what the user typed, and replaces an issue picked before.
					const typed = issue ? content.replace(issue.message, "").trim() : content.trim();
					setContent([picked.message, typed].filter(Boolean).join("\n\n").slice(0, MAX_MESSAGE_LENGTH));
					setIssue(picked);
				}}
			/>
			{issue && (
				<p className="flex flex-wrap items-center gap-3 text-sm text-muted">
					<input type="hidden" name="issueNumber" value={issue.number} />
					Linked to issue #{issue.number}. The pull request will close it. Check the text before you start.
					<button type="button" onClick={() => setIssue(null)} className="underline hover:text-foreground">
						Unlink
					</button>
				</p>
			)}
			<div className="pixel-inset flex flex-col bg-surface focus-within:bg-background focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-ink focus-within:outline-dashed">
				<MessageBox
					projectId={projectId}
					branch={branch}
					listPlacement="below"
					name="content"
					value={content}
					onChange={setContent}
					onKeyDown={(event) => {
						if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
							event.preventDefault();
							event.currentTarget.form?.requestSubmit();
						}
					}}
					required
					maxLength={MAX_MESSAGE_LENGTH}
					rows={7}
					aria-label="Message"
					placeholder="Describe what you want done. Type @ to point at a file, or / for commands."
					className="min-h-44 resize-y bg-transparent p-4 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
				/>

				<div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border px-2 py-2.5">
					<Picker
						icon="project"
						hint="Project to work in"
						align="start"
						name="projectId"
						value={projectId}
						onChange={(event) => {
							const next = projects.find(
								(project) => project.id === event.target.value,
							);
							setProjectId(event.target.value);
							if (issue) {
								setContent(content.replace(issue.message, "").trim());
								setIssue(null);
							}
							if (next) setBranch(next.defaultBranch);
						}}
						aria-label="Project"
					>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.fullName}
							</option>
						))}
					</Picker>

					<Tooltip hint="Base branch to start from">
						<label className="flex h-8 items-center gap-1.5 px-2 text-muted hover:bg-surface-2 hover:text-foreground">
							<PixelIcon name="branch" />
							<input
								name="baseBranch"
								value={branch}
								onChange={(event) => setBranch(event.target.value)}
								required
								maxLength={250}
								aria-label="Base branch"
								placeholder="main"
								className="w-24 bg-transparent font-mono text-xs outline-none"
							/>
						</label>
					</Tooltip>

					<ModelPicker value={model} onChange={setModel} own={ownModels} />
					<ReasoningPicker value={reasoning} onChange={setReasoning} />
					<RunToggles />

					<span className="ml-auto">
						<IconButton
							type="submit"
							disabled={pending || content.trim() === ""}
							icon="send"
							label={pending ? "Starting" : "Start chat"}
							hint="Start chat: Cmd or Ctrl + Enter"
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
	);
}
