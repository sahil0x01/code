"use client";

import { useActionState, useState } from "react";
import { type ChatState, startChat } from "@/actions/chats";
import { buttonClass, field } from "@/components/ui/styles";
import { DEFAULT_MODEL_ID, MAX_MESSAGE_LENGTH, MODELS } from "@/lib/chat";

type ProjectOption = { id: string; fullName: string; defaultBranch: string };

type Props = {
	projects: ProjectOption[];
	initialProjectId: string;
};

const initialState: ChatState = { status: "idle" };

export function Composer({ projects, initialProjectId }: Props) {
	const [state, formAction, pending] = useActionState(startChat, initialState);

	const [projectId, setProjectId] = useState(initialProjectId);
	const [branch, setBranch] = useState(
		() =>
			projects.find((project) => project.id === initialProjectId)
				?.defaultBranch ?? "main",
	);
	const [model, setModel] = useState<string>(DEFAULT_MODEL_ID);
	const [content, setContent] = useState("");

	return (
		<form action={formAction} className="flex flex-col gap-3">
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
					rows={7}
					aria-label="Message"
					placeholder="Describe what you want done. For example: the date parsing test in utils fails on Feb 29, find out why and fix it."
					className="min-h-44 resize-y bg-transparent p-4 text-[15px] leading-relaxed outline-none placeholder:text-subtle"
				/>

				<div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
					<select
						name="projectId"
						value={projectId}
						onChange={(event) => {
							const next = projects.find(
								(project) => project.id === event.target.value,
							);
							setProjectId(event.target.value);
							if (next) setBranch(next.defaultBranch);
						}}
						aria-label="Project"
						className={`${field} min-w-0 max-w-full`}
					>
						{projects.map((project) => (
							<option key={project.id} value={project.id}>
								{project.fullName}
							</option>
						))}
					</select>

					<input
						name="baseBranch"
						value={branch}
						onChange={(event) => setBranch(event.target.value)}
						required
						maxLength={250}
						aria-label="Base branch"
						placeholder="main"
						className={`${field} w-36 font-mono`}
					/>

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

					<button
						type="submit"
						disabled={pending || content.trim() === ""}
						className={`${buttonClass()} ml-auto`}
					>
						{pending ? "Starting..." : "Start chat"}
					</button>
				</div>
			</div>

			<p className="hidden font-mono text-xs text-subtle sm:block">
				Cmd or Ctrl + Enter to start
			</p>

			{state.status === "error" && (
				<p role="alert" className="text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}
