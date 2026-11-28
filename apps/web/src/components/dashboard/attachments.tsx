"use client";

import { type ClipboardEvent, useEffect, useEffectEvent, useRef, useState } from "react";
import { ATTACHMENT_LIMITS, attachmentProblem } from "@/lib/attachments";
import { IconButton } from "./composer-controls";

/** The files picked for the message being written. */
export function useAttachments() {
	const [files, setFiles] = useState<File[]>([]);
	const [problem, setProblem] = useState<string | null>(null);

	const add = (picked: Iterable<File>) => {
		const next = [...files, ...picked];
		const refused = attachmentProblem(next);
		setProblem(refused);
		if (!refused) setFiles(next);
	};

	const [dragging, setDragging] = useState(false);
	const drop = useEffectEvent((dropped: FileList) => add(dropped));

	// The whole page takes a dropped file: a miss would otherwise open it in place of the chat.
	useEffect(() => {
		// Entering a child leaves its parent, so the two are counted.
		let depth = 0;
		const withFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
		const end = () => {
			depth = 0;
			setDragging(false);
		};
		const listeners = {
			dragenter: (event: DragEvent) => {
				if (!withFiles(event)) return;
				depth++;
				setDragging(true);
			},
			dragover: (event: DragEvent) => {
				if (withFiles(event)) event.preventDefault();
			},
			dragleave: (event: DragEvent) => {
				if (withFiles(event) && --depth <= 0) end();
			},
			drop: (event: DragEvent) => {
				if (!withFiles(event)) return;
				event.preventDefault();
				end();
				if (event.dataTransfer?.files.length) drop(event.dataTransfer.files);
			},
			dragend: end,
		};
		const names = Object.keys(listeners) as (keyof typeof listeners)[];
		for (const name of names) window.addEventListener(name, listeners[name]);
		return () => {
			for (const name of names) window.removeEventListener(name, listeners[name]);
		};
	}, []);

	return {
		dragging,
		files,
		problem,
		add,
		remove: (index: number) => {
			setProblem(null);
			setFiles(files.filter((_, at) => at !== index));
		},
		clear: () => setFiles([]),
		/** Kept here, not in the input, which a form clears after every send. */
		attach: (formData: FormData) => {
			formData.delete("files");
			for (const file of files) formData.append("files", file);
			return formData;
		},
		/** Pasting files into the message box adds them. */
		onPaste: (event: ClipboardEvent) => {
			if (event.clipboardData.files.length === 0) return;
			event.preventDefault();
			add(event.clipboardData.files);
		},
	};
}

type Attachments = ReturnType<typeof useAttachments>;

/** Shown over the page while files are dragged across it. */
export function DropHint({ attachments }: { attachments: Attachments }) {
	if (!attachments.dragging) return null;
	return (
		// Lets the drag pass through, so it cannot interrupt itself.
		<div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
			<div className="pixel-inset flex flex-col items-center gap-2 border-2 border-dashed border-ink bg-surface px-10 py-8 text-center">
				<p className="font-semibold">Drop files to attach</p>
				<p className="text-sm text-muted">{ATTACHMENT_LIMITS}</p>
			</div>
		</div>
	);
}

export function AttachButton({ attachments }: { attachments: Attachments }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					attachments.add(event.target.files ?? []);
					// So the same file can be picked again after removing it.
					event.target.value = "";
				}}
			/>
			<IconButton
				type="button"
				tone="secondary"
				icon="attach"
				label="Attach files"
				hint={`Attach, paste or drop files. ${ATTACHMENT_LIMITS}`}
				onClick={() => input.current?.click()}
			/>
		</>
	);
}

export function AttachmentList({ attachments }: { attachments: Attachments }) {
	return (
		<>
			{attachments.files.length > 0 && (
				<ul className="flex flex-wrap gap-2 px-3 pb-2">
					{attachments.files.map((file, index) => (
						<li
							key={`${index}:${file.name}`}
							className="flex max-w-full items-center gap-2 border border-border bg-surface-2 px-2 py-1 font-mono text-xs"
						>
							<span className="truncate">{file.name || "pasted file"}</span>
							<span className="text-subtle">{Math.ceil(file.size / 1024)} KB</span>
							<button
								type="button"
								aria-label={`Remove ${file.name}`}
								onClick={() => attachments.remove(index)}
								className="hover:text-red"
							>
								x
							</button>
						</li>
					))}
				</ul>
			)}
			{attachments.problem && (
				<p role="alert" className="px-3 pb-2 text-sm text-red">
					{attachments.problem}
				</p>
			)}
		</>
	);
}
