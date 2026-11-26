import type { Sandbox } from "@nullfuse/sandbox";
import {
	isStepCount,
	type JSONValue,
	type LanguageModel,
	type ModelMessage,
	type StepResult,
	ToolLoopAgent,
	type ToolSet,
} from "ai";
import { ToolError } from "./errors";
import { SYSTEM_PROMPT } from "./prompt";
import { type AgentTools, createTools } from "./tools";

export type AgentLimits = {
	maxSteps: number;
	maxTokens: number;
	timeoutMs: number;
};

// Placeholders until credits (Phase 8) set a real cap per run.
export const DEFAULT_LIMITS: AgentLimits = {
	maxSteps: 50,
	maxTokens: 2_000_000,
	timeoutMs: 15 * 60_000,
};

export type AgentStep = StepResult<AgentTools>;

export type AgentStopReason = "completed" | "step-limit" | "token-budget" | "timeout" | "aborted";

export type AgentRun = {
	text: string;
	steps: AgentStep[];
	usage: { inputTokens: number; outputTokens: number; totalTokens: number };
	stoppedBy: AgentStopReason;
};

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
	/** Offered to the model beside the built-in tools. */
	tools?: ToolSet;
	limits?: Partial<AgentLimits>;
	/** Aborting stops the run and returns what happened so far. */
	signal?: AbortSignal;
	/** Called after every step, in order. */
	onStep?: (step: AgentStep) => void | Promise<void>;
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

	const agent = new ToolLoopAgent({
		model: options.model,
		providerOptions: options.providerOptions,
		instructions: options.instructions ?? SYSTEM_PROMPT,
		tools: {
			...createTools({ sandbox: options.sandbox, env: options.env }),
			...(options.tools as Partial<AgentTools> | undefined),
		},
		stopWhen: [
			isStepCount(limits.maxSteps),
			({ steps }) => tokensUsed(steps as AgentStep[]) >= limits.maxTokens,
			() => fatal !== undefined,
		],
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
		const result = await agent.generate({
			messages: options.messages,
			abortSignal: options.signal,
			timeout: limits.timeoutMs,
		});
		text = result.text;
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
	else if (unfinished && tokensUsed(steps) >= limits.maxTokens) stoppedBy = "token-budget";
	else if (unfinished && steps.length >= limits.maxSteps) stoppedBy = "step-limit";

	return {
		text,
		steps,
		stoppedBy,
		usage: {
			inputTokens: steps.reduce((sum, step) => sum + inputTokens(step), 0),
			outputTokens: steps.reduce((sum, step) => sum + outputTokens(step), 0),
			totalTokens: tokensUsed(steps),
		},
	};
}
