export type DiffFile = {
	path: string;
	previousPath?: string;
	status: string;
	additions: number;
	deletions: number;
	/** Null when GitHub sends none: binary or very large files. */
	patch: string | null;
};

export type Diff = {
	state: "ok";
	headSha: string;
	files: DiffFile[];
	truncated: boolean;
	url: string;
};

export type DiffResponse =
	| Diff
	| { state: "unchanged" }
	| { state: "not_pushed" }
	| { state: "disconnected" };

export type DiffLine = {
	type: "add" | "remove" | "context";
	oldLine: number | null;
	newLine: number | null;
	text: string;
};

export type Hunk = { header: string; lines: DiffLine[] };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): Hunk[] {
	const hunks: Hunk[] = [];
	let oldLine = 0;
	let newLine = 0;

	for (const raw of patch.split("\n")) {
		const header = HUNK.exec(raw);
		if (header) {
			oldLine = Number(header[1]);
			newLine = Number(header[2]);
			hunks.push({ header: raw, lines: [] });
			continue;
		}

		const lines = hunks.at(-1)?.lines;
		if (!lines) continue;
		const text = raw.slice(1);

		if (raw.startsWith("+")) {
			lines.push({ type: "add", oldLine: null, newLine: newLine++, text });
		} else if (raw.startsWith("-")) {
			lines.push({ type: "remove", oldLine: oldLine++, newLine: null, text });
		} else if (raw.startsWith(" ")) {
			lines.push({ type: "context", oldLine: oldLine++, newLine: newLine++, text });
		}
	}
	return hunks;
}
