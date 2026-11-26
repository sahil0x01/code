import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";
import type { DiffLine, Hunk } from "./diff";

export type Token = { text: string; style?: Record<string, string> };

// Past these, colouring costs more than it helps.
const MAX_LINES = 3000;
const MAX_LINE_LENGTH = 1000;

const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const;

const byName = new Map<string, string>();
for (const info of bundledLanguagesInfo) {
	byName.set(info.id, info.id);
	for (const alias of info.aliases ?? []) byName.set(alias, info.id);
}

// File names and extensions Shiki does not list as aliases.
const extra: Record<string, string> = {
	cc: "cpp",
	h: "c",
	hpp: "cpp",
	htm: "html",
	mod: "go",
	env: "dotenv",
	gitignore: "ini",
	dockerfile: "docker",
};

export function languageFor(path: string) {
	const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
	const extension = name.slice(name.lastIndexOf(".") + 1);
	for (const candidate of [name, extension]) {
		const found = extra[candidate] ?? byName.get(candidate);
		if (found && found in bundledLanguages) return found;
	}
	return null;
}

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
	highlighter ??= createHighlighterCore({
		themes: [
			import("shiki/themes/github-light-default.mjs"),
			import("shiki/themes/github-dark-default.mjs"),
		],
		langs: [],
		engine: createJavaScriptRegexEngine({ forgiving: true }),
	});
	return highlighter;
}

/** One block of code, such as a fence in a reply. Null when it should stay plain. */
export async function highlightCode(name: string, code: string) {
	const language = languageFor(`code.${name}`);
	const lines = code.split("\n");
	if (!language || lines.length > MAX_LINES) return null;
	if (lines.some((line) => line.length > MAX_LINE_LENGTH)) return null;

	const shiki = await getHighlighter();
	await shiki.loadLanguage(bundledLanguages[language as keyof typeof bundledLanguages]);
	const { tokens } = shiki.codeToTokens(code, { lang: language, themes: THEMES, defaultColor: false });
	return tokens.map((line) =>
		line.map((token): Token => ({ text: token.content, style: token.htmlStyle })),
	);
}

/** Colours each hunk's old and new text separately, so removed code does not confuse the new. */
export async function highlightHunks(path: string, hunks: Hunk[]) {
	const language = languageFor(path);
	const lines = hunks.flatMap((hunk) => hunk.lines);
	if (!language || lines.length > MAX_LINES) return null;
	if (lines.some((line) => line.text.length > MAX_LINE_LENGTH)) return null;

	const shiki = await getHighlighter();
	await shiki.loadLanguage(bundledLanguages[language as keyof typeof bundledLanguages]);

	const result = new Map<DiffLine, Token[]>();
	for (const hunk of hunks) {
		// New side last, so unchanged lines take their colours from the new file.
		for (const skip of ["add", "remove"] as const) {
			const side = hunk.lines.filter((line) => line.type !== skip);
			const { tokens } = shiki.codeToTokens(side.map((line) => line.text).join("\n"), {
				lang: language,
				themes: THEMES,
				defaultColor: false,
			});
			side.forEach((line, index) => {
				result.set(
					line,
					(tokens[index] ?? []).map((token) => ({ text: token.content, style: token.htmlStyle })),
				);
			});
		}
	}
	return result;
}
