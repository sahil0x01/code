import type { AgentStep } from "@nullfuse/agent";
import { shellQuote } from "@nullfuse/agent";
import { readText, type Sandbox } from "@nullfuse/sandbox";
import { type Recording, recordChange, recordPage, SCRIPT_PATH } from "./recording";

/** Where the agent may list commands that show its work. Outside the workspace, so never committed. */
export const COMMANDS_PATH = "/tmp/nullfuse-record/commands.json";

const MAX_COMMANDS = 6;
const MAX_COMMAND_CHARS = 500;
const MAX_OUTPUT_CHARS = 4_000;
const MAX_DIFF_CHARS = 12_000;
const MAX_FILES = 6;
const MAX_LINES = 40;
const COMMAND_TIMEOUT_MS = 60_000;

export function proofInstructions(app: { port: number } | undefined) {
	const commands = `write ${COMMANDS_PATH} as a JSON array of up to ${MAX_COMMANDS} shell commands whose output shows the behaviour (tests, a build, a request to the server, the logs that matter). They are run again after you finish, in the workspace, and their real output is recorded. Each must finish on its own within a minute.`;
	const when =
		"Record proof only when a reviewer would need to see something to trust the work: a change to what a user sees, to how code behaves, or output and logs that settle a question. Write nothing for documentation, comments, renames, formatting or a plain answer.";
	if (!app) return `${when} When proof is needed, ${commands}`;
	return `${when}
For something that shows in the web app, write a Playwright script to ${SCRIPT_PATH} that demonstrates it. It must be an ES module like:
export default async ({ page, expect, shot }) => { await page.goto("/"); /* use the changed feature, assert the result with expect */ await shot("What this shows"); };
Do not import anything, do not start the app (it is started for you on port ${app.port}), and keep it under 30 seconds. \`shot\` saves a screenshot; call it at up to three moments that matter. Prefer role, label and text locators. To try the same steps first, pass the script to the check_app tool, leaving out \`shot\`.
For behaviour that does not show in a web page, instead ${commands}`;
}

export type ProofInput = {
	/** The files this run changed. */
	changed: string[];
	steps: AgentStep[];
	/** The commit the run started from. */
	baseSha: string;
	app?: { startCommand: string; port: number };
	env: Record<string, string>;
	redact(text: string): string;
	signal: AbortSignal;
};

export type Proof = Recording & { kind: "web" | "page" };

type Block = { title: string; text: string };
type Section = { heading: string; blocks: Block[] };

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n[cut]` : text);
const tail = (text: string, max: number) => (text.length > max ? `[cut]\n${text.slice(-max)}` : text);

const escapeHtml = (text: string) =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** A page with nothing in it that could run or load: every piece of text is escaped. */
export function proofPage(sections: Section[], redact: (text: string) => string) {
	// Hidden before escaping, which would change a secret and stop it matching.
	const safe = (text: string) => escapeHtml(redact(text));
	const body = sections
		.filter((section) => section.blocks.length > 0)
		.map(
			(section) =>
				`<h2>${safe(section.heading)}</h2>${section.blocks
					.map((block) => `${block.title ? `<h3>${safe(block.title)}</h3>` : ""}<pre>${safe(block.text)}</pre>`)
					.join("")}`,
		)
		.join("");
	return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
body{margin:0;padding:32px 48px;background:#101014;color:#e8e6df;font:16px/1.5 ui-monospace,monospace}
h1{font-size:22px;margin:0 0 8px}h2{font-size:15px;margin:28px 0 8px;color:#f2d366;text-transform:uppercase}
h3{font-size:14px;margin:12px 0 4px;color:#9fd0a8;white-space:pre-wrap;overflow-wrap:anywhere}
pre{margin:0;padding:12px;background:#1b1b22;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
</style><h1>Proof of work, recorded by Prefill</h1>${body}`;
}

async function listedCommands(sandbox: Sandbox) {
	try {
		const value: unknown = JSON.parse(await readText(sandbox, COMMANDS_PATH));
		if (!Array.isArray(value)) return [];
		return value
			.filter((item): item is string => typeof item === "string" && item.trim() !== "")
			.filter((item) => item.length <= MAX_COMMAND_CHARS)
			.slice(0, MAX_COMMANDS);
	} catch {
		return [];
	}
}

const calls = (steps: AgentStep[], name: string) =>
	steps.flatMap((step) =>
		step.toolCalls
			.filter((call) => call.toolName === name)
			.map((call) => ({
				input: Object(call.input) as Record<string, unknown>,
				output: String(step.toolResults.find((result) => result.toolCallId === call.toolCallId)?.output ?? ""),
			})),
	);

/** Commands run now and recorded here, or else what the agent's own commands printed. */
async function commandSection(sandbox: Sandbox, input: ProofInput) {
	const listed = await listedCommands(sandbox);
	let passed = true;
	if (listed.length > 0) {
		const blocks: Block[] = [];
		for (const command of listed) {
			if (input.signal.aborted) break;
			const result = await sandbox.exec(command, {
				env: input.env,
				timeoutMs: COMMAND_TIMEOUT_MS,
				signal: input.signal,
			});
			const ok = result.exitCode === 0 && !result.timedOut;
			passed &&= ok;
			const how = result.timedOut ? "timed out" : `exit code ${result.exitCode}`;
			blocks.push({
				title: `$ ${command}  (${how})`,
				// Hidden before cutting, so a cut cannot leave half a secret behind.
				text: tail(input.redact(`${result.stdout}${result.stderr}`.trim()) || "(no output)", MAX_OUTPUT_CHARS),
			});
		}
		return { passed, section: { heading: "Commands, run again after the work", blocks } };
	}
	const blocks = calls(input.steps, "bash")
		.slice(-MAX_COMMANDS)
		.map(({ input: call, output }) => ({
			title: `$ ${clip(String(call.command ?? ""), MAX_COMMAND_CHARS)}`,
			text: tail(input.redact(output), MAX_OUTPUT_CHARS),
		}));
	return { passed, section: { heading: "Commands, as run during the work", blocks } };
}

async function changeSection(sandbox: Sandbox, input: ProofInput): Promise<Section> {
	const result = await sandbox.exec(
		`git diff --stat ${shellQuote(input.baseSha)} -- && git diff ${shellQuote(input.baseSha)} --`,
	);
	const text = result.exitCode === 0 ? result.stdout.trim() : "";
	return {
		heading: "Changes",
		blocks: text ? [{ title: "", text: clip(input.redact(text), MAX_DIFF_CHARS) }] : [],
	};
}

async function pageProof(sandbox: Sandbox, input: ProofInput, note?: string): Promise<Proof> {
	const commands = await commandSection(sandbox, input);
	const sections: Section[] = [
		{ heading: "Note", blocks: note ? [{ title: "", text: note }] : [] },
		commands.section,
		await changeSection(sandbox, input),
	];
	const result = await recordPage(sandbox, proofPage(sections, input.redact), input.signal);
	if (result.status === "recorded") result.passed &&= commands.passed;
	return { ...result, kind: "page" };
}

// Nothing to watch: text that is read, not run.
const READ_ONLY_FILES = /(\.(md|mdx|txt|rst|adoc)|(^|\/)(LICENSE|NOTICE|\.gitignore|\.editorconfig))$/i;

export const changesCode = (files: string[]) => files.some((file) => !READ_ONLY_FILES.test(file));

/**
 * A video and screenshots of work that needs seeing: the web app driven by the agent's
 * script, or a page of command output and changes. Null when there is nothing to prove,
 * which is when the agent asked for none and no code changed.
 */
export async function captureProof(sandbox: Sandbox, input: ProofInput): Promise<Proof | null> {
	let script: string | undefined;
	if (input.app) script = await readText(sandbox, SCRIPT_PATH).catch(() => undefined);
	if (input.app && script !== undefined) {
		const web = await recordChange(sandbox, { ...input.app, script, env: input.env, signal: input.signal });
		if (web.status === "recorded") return { ...web, kind: "web" };
		return pageProof(sandbox, input, `The web app could not be recorded. ${web.message}`);
	}
	const asked = (await listedCommands(sandbox)).length > 0;
	return asked || changesCode(input.changed) ? pageProof(sandbox, input) : null;
}
