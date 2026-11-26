import { type DiffFile, type DiffLine, parsePatch } from "./diff";

export type DraftComment = {
	path: string;
	/** "old" for a removed line, which only has a number in the old file. */
	side: "old" | "new";
	line: number;
	code: string;
	body: string;
};

export function anchorFor(path: string, line: DiffLine): Omit<DraftComment, "body"> {
	return line.newLine === null
		? { path, side: "old", line: line.oldLine ?? 0, code: line.text }
		: { path, side: "new", line: line.newLine, code: line.text };
}

export function commentKey(comment: Pick<DraftComment, "path" | "side" | "line">) {
	return `${comment.side}:${comment.line}:${comment.path}`;
}

/** A draft is outdated once its line no longer reads the same in the diff. */
export function isOutdated(comment: DraftComment, files: DiffFile[]) {
	const patch = files.find((file) => file.path === comment.path)?.patch;
	if (!patch) return true;
	return !parsePatch(patch).some((hunk) =>
		hunk.lines.some((line) => {
			const anchor = anchorFor(comment.path, line);
			return commentKey(anchor) === commentKey(comment) && anchor.code === comment.code;
		}),
	);
}

export function formatReview(comments: DraftComment[], files: DiffFile[]) {
	const blocks = [...comments]
		.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
		.map((comment) => {
			const where = comment.side === "old" ? "removed line" : "line";
			const stale = isOutdated(comment, files) ? " (the code has changed since this comment)" : "";
			return `${comment.path}, ${where} ${comment.line}${stale}\n> ${comment.code}\n${comment.body.trim()}`;
		});
	return ["Please address these review comments:", ...blocks].join("\n\n");
}
