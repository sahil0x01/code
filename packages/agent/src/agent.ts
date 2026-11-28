import type { Sandbox } from "@nullfuse/sandbox";
import {
	generateText,
	isStepCount,
	type JSONValue,
	type LanguageModel,
	type ModelMessage,
	type StepResult,
	ToolLoopAgent,
	type ToolSet,
} from "ai";
import {
	compacted,
	compactionThreshold,
	estimateTokens,
	MIN_STEPS_BETWEEN,
	SUMMARY_PROMPT,
	transcript,
} from "./compact";
import { ToolError } from "./errors";
import { readWithGuidance } from "./guidance";
import { SYSTEM_PROMPT } from "./prompt";
import { taskTool } from "./task";
import { type AgentTools, createTools } from "./tools";

export type AgentLimits = {
	maxSteps: number;
	maxTokens: number;
	timeoutMs: number;
	/** Millionths of a dollar. Only counts when `stepCost` is given. */
	maxCost: number;
};

// Placeholders until credits (Phase 8) set a real cap per run.
export const DEFAULT_LIMITS: AgentLimits = {
	maxSteps: 100,
	maxTokens: 2_000_000,
	timeoutMs: 15 * 60_000,
	maxCost: 1_000_000,
};

export type AgentStep = StepResult<AgentTools>;

export type AgentStopReason = 
	| "completed"
	| "step-limit"
	| "token-budget"
	| "cost-limit"
	| "timeout"
	| "aborted";

export type AgentRun = {
	text: string;
	steps: AgentStep[];
	usage: { inputTokens: number; outputTokens: number; totalTokens: number };
	stoppedBy: AgentStopReason;
};

/** A piece of the model's output as it arrives. */
export type AgentDelta =
	| { kind: "reasoning" | "text"; text: string }
	| { kind: "tool"; name: string };

export type RunAgentOptions = {
	model: LanguageModel;
	sandbox: Sandbox;
	/** The conversation so far, ending with the message to answer. */
	messages: ModelMessage[];
	/** Added to every command the bash tool runs. */
	env?: Record<string, string>;
	instructions?: string;
	/** Settings only one provider understands, such as how hard to think. */
	providerOptions?: Record<string, Record<string, JSONValue>>;
	/** How hard to think, in the SDK's own words, for providers that take it that way. */
	reasoning?: "none" | "low" | "high" | "xhigh";
	maxOutputTokens?: number;
	/** Offered to the model beside the built-in tools. */
	tools?: ToolSet;
	limits?: Partial<AgentLimits>;
	/** The model can look at an image a tool gives it. */
	toolImages?: boolean;
	/** Leaves out the tools that change files or run commands. */
	readOnly?: boolean;
	/** Aborting stops the run and returns what happened so far. */
	signal?: AbortSignal;
	/** When given, the model's output is streamed and passed here as it arrives. */
	onDelta?: (delta: AgentDelta) => void;
	/** What a step cost, in millionths of a dollar, for the spending cap. */
	stepCost?: (step: AgentStep) => number;
	/** Called after every step, in order. */
	onStep?: (step: AgentStep) => void | Promise<void>;
	/** The model's context window. History is compacted as it nears this. */
	contextTokens?: number;
	/** The commit the run started from, which a review compares against. */
	baseSha?: string;
	/** Instructions from the repository, passed on to helpers. */
	guidance?: string;
	/** Model use outside the main steps: helpers and compaction. */
	onSpend?: (step: AgentStep) => void | Promise<void>;
};

function inputTokens(step: AgentStep) {
	return step.usage.inputTokens ?? 0;
}

function outputTokens(step: AgentStep) {
	return step.usage.outputTokens ?? 0;
}

function tokensUsed(steps: AgentStep[]) {
	return steps.reduce(
		(sum, step) => sum + (step.usage.totalTokens ?? inputTokens(step) + outputTokens(step)),
		0,
	);
}

function isAbort(error: unknown) {
	let current = error;
	for (let depth = 0; current instanceof Error && depth < 5; depth++) {
		if (current.name === "AbortError" || current.name === "TimeoutError") return true;
		current = current.cause;
	}
	return false;
}

export async function runAgent(options: RunAgentOptions): Promise<AgentRun> {
	if (options.signal?.aborted) {
		return {
			text: "",
			steps: [],
			stoppedBy: "aborted",
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		};
	}
	const limits = { ...DEFAULT_LIMITS, ...options.limits };
	const steps: AgentStep[] = [];
	let fatal: { error: unknown } | undefined;

	// Helpers and compaction use the model too, and count against the same limits.
	const aside: AgentStep[] = [];
	const spend = async (step: AgentStep) => {
		aside.push(step);
		await options.onSpend?.(step);
	};
	const costOf = (taken: AgentStep[]) =>
		[...taken, ...aside].reduce((sum, step) => sum + (options.stepCost?.(step) ?? 0), 0);
	const usedWith = (taken: AgentStep[]) => tokensUsed([...taken, ...aside]);
	const overBudget = () => usedWith(steps) >= limits.maxTokens || costOf(steps) >= limits.maxCost;

	const builtIn = createTools({ sandbox: options.sandbox, env: options.env, images: options.toolImages });
	const guided = readWithGuidance(builtIn.read, options.sandbox);
	builtIn.read = guided.read;
	const task = taskTool({
		model: options.model,
		sandbox: options.sandbox,
		settings: {
			providerOptions: options.providerOptions,
			reasoning: options.reasoning,
			maxOutputTokens: options.maxOutputTokens,
		},
		baseSha: options.baseSha,
		guidance: options.guidance,
		spend,
		overBudget,
		fatal: (error) => {
			fatal ??= { error };
		},
	});
	const reading = { list: builtIn.list, read: builtIn.read, grep: builtIn.grep } as AgentTools;

	const threshold = compactionThreshold(options.contextTokens);
	let compactedAt: number | undefined;
	let compactionOff = false;
	/** The history as one summary, or null to carry on with it as it is. */
	async function compact(messages: ModelMessage[]) {
		try {
			const result = await generateText({
				model: options.model,
				providerOptions: options.providerOptions,
				maxOutputTokens: options.maxOutputTokens,
				instructions: SUMMARY_PROMPT,
				prompt: transcript(messages, threshold),
				abortSignal: options.signal,
			});
			await spend(result.steps[0] as unknown as AgentStep);
			const summary = result.text.trim();
			const request = [...options.messages].reverse().find((message) => message.role === "user");
			if (!summary) return null;
			// The last step stays only when it is small enough not to fill the room just made.
			const recent = steps.at(-1)?.response.messages ?? [];
			return compacted(request, summary, estimateTokens(recent) < threshold / 3 ? recent : []);
		} catch (error) {
			if (options.signal?.aborted) throw error;
			console.warn("compaction failed", error instanceof Error ? error.name : "unknown");
			return null;
		}
	}

	const agent = new ToolLoopAgent({
		model: options.model,
		providerOptions: options.providerOptions,
		reasoning: options.reasoning,
		maxOutputTokens: options.maxOutputTokens,
		instructions: options.instructions ?? SYSTEM_PROMPT,
		tools: {
			...(options.readOnly ? reading : builtIn),
			task,
			...(options.readOnly ? undefined : (options.tools as Partial<AgentTools> | undefined)),
		},
		stopWhen: [
			isStepCount(limits.maxSteps),
			({ steps }) => usedWith(steps as AgentStep[]) >= limits.maxTokens,
			({ steps }) => costOf(steps as AgentStep[]) >= limits.maxCost,
			() => fatal !== undefined,
		],
		prepareStep: async ({ messages }) => {
			const last = steps.at(-1);
			// What the provider counted last time, plus the results added since.
			const size = last
				? inputTokens(last) + outputTokens(last) + estimateTokens(last.toolResults.map((result) => result.output))
				: estimateTokens(messages);
			if (compactionOff || size < threshold || overBudget()) return {};
			// Compacting again so soon would only make the agent forget and start over.
			if (compactedAt !== undefined && steps.length - compactedAt < MIN_STEPS_BETWEEN) {
				compactionOff = true;
				console.warn("compaction stopped: the context window is too small for it");
				return {};
			}
			const shorter = await compact(messages);
			if (!shorter) return {};
			compactedAt = steps.length;
			guided.forget();
			// The SDK carries these forward, so later steps build on the summary.
			return { messages: shorter };
		},
		// The SDK shows every error a tool throws to the model. Only ToolError is
		// meant for the model; anything else (the sandbox died) must fail the run.
		onToolExecutionEnd: ({ toolOutput }) => {
			if (toolOutput.type === "tool-error" && !(toolOutput.error instanceof ToolError)) {
				fatal ??= { error: toolOutput.error };
			}
		},
		onStepEnd: async (step) => {
			steps.push(step as AgentStep);
			await options.onStep?.(step as AgentStep);
		},
	});

	let text = "";
	let aborted = false;
	try {
		const call = {
			messages: options.messages,
			abortSignal: options.signal,
			timeout: limits.timeoutMs,
		};
		const { onDelta } = options;
		if (!onDelta) {
			text = (await agent.generate(call)).text;
		} else {
			// A stream reports aborts and provider errors as parts instead of throwing.
			const result = await agent.stream(call);
			for await (const part of result.stream) {
				if (part.type === "reasoning-delta") onDelta({ kind: "reasoning", text: part.text });
				else if (part.type === "text-delta") onDelta({ kind: "text", text: part.text });
				else if (part.type === "tool-input-start") onDelta({ kind: "tool", name: part.toolName });
				else if (part.type === "error") throw part.error;
				else if (part.type === "abort") aborted = true;
			}
			text = steps.at(-1)?.text ?? "";
		}
	} catch (error) {
		if (fatal) throw fatal.error;
		if (!isAbort(error)) throw error;
		aborted = true;
		text = steps.at(-1)?.text ?? "";
	}
	if (fatal) throw fatal.error;

	const last = steps.at(-1);
	const unfinished = last?.finishReason === "tool-calls";
	let stoppedBy: AgentStopReason = "completed";
	if (aborted) stoppedBy = options.signal?.aborted ? "aborted" : "timeout";
	else if (unfinished && costOf(steps) >= limits.maxCost) stoppedBy = "cost-limit";
	else if (unfinished && usedWith(steps) >= limits.maxTokens) stoppedBy = "token-budget";
	else if (unfinished && steps.length >= limits.maxSteps) stoppedBy = "step-limit";

	return {
		text,
		steps,
		stoppedBy,
		usage: {
			inputTokens: [...steps, ...aside].reduce((sum, step) => sum + inputTokens(step), 0),
			outputTokens: [...steps, ...aside].reduce((sum, step) => sum + outputTokens(step), 0),
			totalTokens: usedWith(steps),
		},
	};
}
