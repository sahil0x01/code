import type { Sandbox } from "@nullfuse/sandbox";
import { ToolError } from "./errors";

export function shellQuote(value: string) {
	if (value.includes("\0")) {
		throw new ToolError("Values cannot contain a NUL character.");
	}
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type PathInfo =
	| { kind: "missing" }
	| { kind: "dir" }
	| { kind: "file"; size: number }
	| { kind: "other" };

export async function probePath(sandbox: Sandbox, path: string): Promise<PathInfo> {
	const q = shellQuote(path);
	const result = await sandbox.exec(
		`if [ -d ${q} ]; then echo dir; ` +
			`elif [ -f ${q} ]; then echo "file $(wc -c < ${q})"; ` +
			`elif [ -e ${q} ]; then echo other; ` +
			"else echo missing; fi",
	);

	const answer = result.stdout.trim();
	if (answer === "dir") return { kind: "dir" };
	if (answer === "other") return { kind: "other" };
	if (answer === "missing") return { kind: "missing" };
	const file = /^file\s+(\d+)$/.exec(answer);
	if (result.exitCode === 0 && file?.[1]) return { kind: "file", size: Number(file[1]) };
	throw new Error(`Could not inspect ${path}: ${answer || result.stderr.trim()}`);
}

export function headAndTail(text: string, max: number, headShare = 1 / 3) {
	if (text.length <= max) return text;
	const head = Math.floor(max * headShare);
	const tail = max - head;
	return `${text.slice(0, head)}\n[... ${text.length - max} characters omitted ...]\n${text.slice(text.length - tail)}`;
}

export function pluralize(count: number, noun: string) {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
