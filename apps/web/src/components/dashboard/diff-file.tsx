"use client";

import { PixelChevron } from "@/components/ui/pixel-chevron";
import { type CSSProperties, Fragment, memo, useEffect, useMemo, useState } from "react";
import { buttonClass, field } from "@/components/ui/styles";
import { type DiffFile, type DiffLine, type Hunk, parsePatch } from "@/lib/diff";
import type { Token } from "@/lib/highlight";
import { anchorFor, commentKey, type DraftComment } from "@/lib/review";

// Bigger files start closed so a large change stays quick to open.
const OPEN_UP_TO_LINES = 400;

const lineStyle: Record<DiffLine["type"], { mark: string; row: string }> = {
	add: { mark: "+", row: "bg-green/15" },
	remove: { mark: "-", row: "bg-red/15" },
	context: { mark: " ", row: "" },
};

type Props = {
	file: DiffFile;
	url: string;
	drafts: DraftComment[];
	onSave: (draft: DraftComment) => void;
	onRemove: (draft: DraftComment) => void;
};

function Editor({
	initial,
	onSave,
	onCancel,
}: {
	initial: string;
	onSave: (body: string) => void;
	onCancel: () => void;
}) {
	const [body, setBody] = useState(initial);
	const save = () => body.trim() && onSave(body.trim());

	return (
		<div className="flex flex-col gap-2 border-y border-border bg-surface p-3 font-sans">
			<textarea
				autoFocus
				value={body}
				onChange={(event) => setBody(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") onCancel();
					if ((event.metaKey || event.ctrlKey) && event.key === "Enter") save();
				}}
				rows={3}
				aria-label="Comment"
				placeholder="What should change here?"
				className={`${field} h-auto min-h-20 resize-y py-2 whitespace-normal`}
			/>
			<div className="flex gap-3">
				<button type="button" onClick={save} disabled={!body.trim()} className={buttonClass("primary", "sm")}>
					Add comment
				</button>
				<button type="button" onClick={onCancel} className={buttonClass("secondary", "sm")}>
					Cancel
				</button>
			</div>
		</div>
	);
}

function Draft({
	draft,
	onEdit,
	onRemove,
	note,
}: {
	draft: DraftComment;
	onEdit?: () => void;
	onRemove: () => void;
	note: string;
}) {
	return (
		<div className="flex flex-col gap-1 border-y border-border bg-surface p-3 font-sans">
			<p className="font-mono text-xs uppercase text-subtle">{note}</p>
			<p className="whitespace-pre-wrap break-words text-sm">{draft.body}</p>
			<div className="flex gap-3 text-xs text-muted">
				{onEdit && (
					<button type="button" onClick={onEdit} className="underline hover:text-foreground">
						Edit
					</button>
				)}
				<button type="button" onClick={onRemove} className="underline hover:text-foreground">
					Delete
				</button>
			</div>
		</div>
	);
}

// The highlighter is loaded only when a file is shown, and lines stay plain until it is ready.
function useHighlight(path: string, hunks: Hunk[], enabled: boolean) {
	const [done, setDone] = useState<{ hunks: Hunk[]; tokens: Map<DiffLine, Token[]> }>();

	useEffect(() => {
		if (!enabled) return;
		let current = true;
		import("@/lib/highlight")
			.then(({ highlightHunks }) => highlightHunks(path, hunks))
			.then((tokens) => {
				if (current && tokens) setDone({ hunks, tokens });
			})
			.catch((error) => console.warn("highlighting failed", error));
		return () => {
			current = false;
		};
	}, [path, hunks, enabled]);

	return done?.hunks === hunks ? done.tokens : undefined;
}

export const DiffFileView = memo(function DiffFileView({ file, url, drafts, onSave, onRemove }: Props) {
	const hunks = useMemo(() => (file.patch ? parsePatch(file.patch) : []), [file.patch]);
	const lineCount = hunks.reduce((total, hunk) => total + hunk.lines.length, 0);
	const [open, setOpen] = useState(lineCount <= OPEN_UP_TO_LINES);
	const [editing, setEditing] = useState<string | null>(null);
	const tokens = useHighlight(file.path, hunks, open);

	const byKey = new Map(drafts.map((draft) => [commentKey(draft), draft]));
	const shown = new Set<string>();
	for (const hunk of hunks) {
		for (const line of hunk.lines) {
			const anchor = anchorFor(file.path, line);
			if (byKey.get(commentKey(anchor))?.code === anchor.code) shown.add(commentKey(anchor));
		}
	}
	const outdated = drafts.filter((draft) => !shown.has(commentKey(draft)));

	return (
		<li className="pixel-inset bg-background">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex w-full items-center gap-2 bg-surface px-3 py-2 text-left font-mono text-xs"
			>
				<span className="text-subtle">
					<PixelChevron open={open} />
				</span>
				<span className="min-w-0 flex-1 break-all">
					{file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
				</span>
				{drafts.length > 0 && <span className="text-blue">{drafts.length} draft</span>}
				<span className="text-green">+{file.additions}</span>
				<span className="text-red">−{file.deletions}</span>
			</button>

			{open && hunks.length === 0 && (
				<p className="p-3 text-sm text-muted">
					No preview: the file is binary, too large, or only renamed.{" "}
					<a href={url} target="_blank" rel="noreferrer" className="underline">
						View on GitHub ↗
					</a>
				</p>
			)}

			{open && hunks.length > 0 && (
				<div className="relative overflow-x-auto font-mono text-xs leading-6">
					<div className="w-max min-w-full">
						{hunks.map((hunk) => (
							<Fragment key={hunk.header}>
								<p className="whitespace-pre bg-surface-2 px-3 text-subtle">{hunk.header}</p>
								{hunk.lines.map((line) => {
									const anchor = anchorFor(file.path, line);
									const key = commentKey(anchor);
									const draft = shown.has(key) ? byKey.get(key) : undefined;
									const number = anchor.line;
									return (
										<Fragment key={key}>
											<div className={`flex ${lineStyle[line.type].row}`}>
												<button
													type="button"
													onClick={() => setEditing(key)}
													aria-label={`Comment on ${file.path}, ${anchor.side === "old" ? "removed line" : "line"} ${number}`}
													title="Comment on this line"
													className="sticky left-0 w-12 shrink-0 select-none border-r border-border bg-surface pr-2 text-right text-subtle hover:bg-accent hover:text-accent-foreground"
												>
													{number}
												</button>
												<span className="whitespace-pre px-2 [tab-size:4]">
													{lineStyle[line.type].mark}{" "}
													{tokens?.get(line)?.map((token, index) => (
														<span
															key={index}
															className="text-(--shiki-light) dark:text-(--shiki-dark)"
															style={token.style as CSSProperties}
														>
															{token.text}
														</span>
													)) ?? line.text}
												</span>
											</div>
											{(editing === key || draft) && (
												<div className="sticky left-0 max-w-xl">
													{editing === key ? (
														<Editor
															initial={draft?.body ?? ""}
															onCancel={() => setEditing(null)}
															onSave={(body) => {
																onSave({ ...anchor, body });
																setEditing(null);
															}}
														/>
													) : (
														draft && (
															<Draft
																draft={draft}
																note="Draft comment"
																onEdit={() => setEditing(key)}
																onRemove={() => onRemove(draft)}
															/>
														)
													)}
												</div>
											)}
										</Fragment>
									);
								})}
							</Fragment>
						))}
					</div>
				</div>
			)}

			{open &&
				outdated.map((draft) => (
					<Draft
						key={commentKey(draft)}
						draft={draft}
						note={`Outdated draft · line ${draft.line} · ${draft.code.trim()}`}
						onRemove={() => onRemove(draft)}
					/>
				))}
		</li>
	);
});
