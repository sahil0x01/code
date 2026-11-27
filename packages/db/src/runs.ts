import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
	type ChangedFile,
	chat,
	message,
	project,
	projectEnvVar,
	run,
	type RunStopReason,
	type RunLive,
	type RunRecording,
	type RunVerification,
	runStep,
	type StepToolCall,
	type StepToolResult,
	type ReasoningLevel,
} from "./schema";

export type ClaimResult =
	| {
			ok: true;
			run: {
				id: string;
				chatId: string;
				userId: string;
				messageId: string;
				model: string;
				/** Which start this is. Passed back on every write, so an old worker cannot touch a newer attempt. */
				attempt: number;
			};
	  }
	| { ok: false; reason: "not_found" | "not_queued" | "busy" | "not_next" | "user_busy" };

// Lock order is always chat first, then run, so a claim, a finish and a delete
// can never wait on each other in a circle.
export function claimRun(db: Db, runId: string, options: { maxRunningPerUser?: number } = {}) {
	return db.transaction(async (tx): Promise<ClaimResult> => {
		const [target] = await tx
			.select({ chatId: run.chatId, userId: run.userId })
			.from(run)
			.where(eq(run.id, runId));
		if (!target) return { ok: false, reason: "not_found" };

		// One claim at a time per user, so the cap below cannot be passed by two
		// chats claiming at the same moment.
		if (options.maxRunningPerUser !== undefined) {
			await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${target.userId}))`);
		}

		await tx
			.select({ id: chat.id })
			.from(chat)
			.where(eq(chat.id, target.chatId))
			.for("update");

		// Read again: the run may have been cancelled or deleted while we waited.
		const [current] = await tx
			.select({
				id: run.id,
				chatId: run.chatId,
				userId: run.userId,
				messageId: run.messageId,
				model: run.model,
				status: run.status,
			})
			.from(run)
			.where(eq(run.id, runId));
		if (!current) return { ok: false, reason: "not_found" };
		if (current.status !== "queued") return { ok: false, reason: "not_queued" };

		const [running] = await tx
			.select({ id: run.id })
			.from(run)
			.where(and(eq(run.chatId, current.chatId), eq(run.status, "running")))
			.limit(1);
		if (running) return { ok: false, reason: "busy" };

		// Runs in a chat go in order: a follow-up builds on the earlier run's files.
		// Compared inside the database so timestamps keep their full precision.
		const [older] = await tx
			.select({ id: run.id })
			.from(run)
			.where(
				and(
					eq(run.chatId, current.chatId),
					eq(run.status, "queued"),
					sql`(${run.createdAt}, ${run.id}) < (select created_at, id from run where id = ${runId})`,
				),
			)
			.limit(1);
		if (older) return { ok: false, reason: "not_next" };

		if (options.maxRunningPerUser !== undefined) {
			const [{ total } = { total: 0 }] = await tx
				.select({ total: sql<number>`count(*)::int` })
				.from(run)
				.where(and(eq(run.userId, current.userId), eq(run.status, "running")));
			if (total >= options.maxRunningPerUser) return { ok: false, reason: "user_busy" };
		}

		const now = new Date();
		const [started] = await tx
			.update(run)
			.set({
				live: null,
				status: "running",
				startedAt: sql`coalesce(${run.startedAt}, ${now.toISOString()}::timestamptz)`,
				heartbeatAt: now,
				attempts: sql`${run.attempts} + 1`,
				updatedAt: now,
			})
			.where(eq(run.id, runId))
			.returning({ attempt: run.attempts });

		const { status: _status, ...claimed } = current;
		return { ok: true, run: { ...claimed, attempt: started?.attempt ?? 1 } };
	});
}

/** Puts a claimed run that never started back in the queue, without using up an attempt. */
export async function releaseRun(db: Db, runId: string, attempt: number) {
	const rows = await db
		.update(run)
		.set({
			status: "queued",
			attempts: attempt - 1,
			startedAt: attempt === 1 ? null : sql`${run.startedAt}`,
			heartbeatAt: null,
			updatedAt: new Date(),
		})
		.where(and(eq(run.id, runId), eq(run.status, "running"), eq(run.attempts, attempt)))
		.returning({ id: run.id });
	return rows.length === 1;
}

export type StepRecord = {
	stepIndex: number;
	finishReason: string;
	text: string;
	toolCalls: StepToolCall[];
	toolResults: StepToolResult[];
	inputTokens: number;
	outputTokens: number;
	reasoning?: string;
	cachedInputTokens?: number;
	reasoningTokens?: number;
};

// Saving the same step twice (a retried task) is a no-op, and its tokens are
// not counted twice. Steps for a run that is no longer running are dropped.
export function recordStep(db: Db, runId: string, step: StepRecord, attempt?: number) {
	return db.transaction(async (tx): Promise<{ recorded: boolean }> => {
		const [current] = await tx
			.select({ status: run.status, attempts: run.attempts })
			.from(run)
			.where(eq(run.id, runId))
			.for("update");
		if (!current || current.status !== "running") return { recorded: false };
		if (attempt !== undefined && current.attempts !== attempt) return { recorded: false };

		const inserted = await tx
			.insert(runStep)
			.values({ runId, ...step })
			.onConflictDoNothing()
			.returning({ id: runStep.id });
		if (inserted.length === 0) return { recorded: false };

		await tx
			.update(run)
			.set({
				inputTokens: sql`${run.inputTokens} + ${step.inputTokens}`,
				outputTokens: sql`${run.outputTokens} + ${step.outputTokens}`,
				cachedInputTokens: sql`${run.cachedInputTokens} + ${step.cachedInputTokens ?? 0}`,
				reasoningTokens: sql`${run.reasoningTokens} + ${step.reasoningTokens ?? 0}`,
				live: null,
				updatedAt: new Date(),
			})
			.where(eq(run.id, runId));
		return { recorded: true };
	});
}

export type RunOutcome = {
	status: "succeeded" | "failed" | "cancelled";
	stopReason: RunStopReason;
	error?: string;
	/** What the agent said at the end. Saved as the assistant's message. */
	text?: string;
};

export type FinishResult =
	| { ok: true; messageId: string | null }
	| { ok: false; reason: "not_found" | "not_running" };

export function finishRun(db: Db, runId: string, outcome: RunOutcome, attempt?: number) {
	return db.transaction(async (tx): Promise<FinishResult> => {
		const [target] = await tx
			.select({ chatId: run.chatId })
			.from(run)
			.where(eq(run.id, runId));
		if (!target) return { ok: false, reason: "not_found" };

		await tx
			.select({ id: chat.id })
			.from(chat)
			.where(eq(chat.id, target.chatId))
			.for("update");

		const [current] = await tx
			.select({ chatId: run.chatId, status: run.status, attempts: run.attempts })
			.from(run)
			.where(eq(run.id, runId))
			.for("update");
		if (!current) return { ok: false, reason: "not_found" };
		if (current.status !== "running") return { ok: false, reason: "not_running" };
		if (attempt !== undefined && current.attempts !== attempt) {
			return { ok: false, reason: "not_running" };
		}

		const now = new Date();
		await tx
			.update(run)
			.set({
				live: null,
				status: outcome.status,
				stopReason: outcome.stopReason,
				error: outcome.error ?? null,
				finishedAt: now,
				updatedAt: now,
			})
			.where(eq(run.id, runId));

		let messageId: string | null = null;
		const text = outcome.text?.trim();
		if (text) {
			const [created] = await tx
				.insert(message)
				.values({ chatId: current.chatId, role: "assistant", content: text, runId })
				.returning({ id: message.id });
			messageId = created?.id ?? null;
		}

		await tx.update(chat).set({ updatedAt: now }).where(eq(chat.id, current.chatId));
		return { ok: true, messageId };
	});
}

export function listRunSteps(db: Db, userId: string, runId: string) {
	return db
		.select({
			id: runStep.id,
			stepIndex: runStep.stepIndex,
			finishReason: runStep.finishReason,
			text: runStep.text,
			reasoning: runStep.reasoning,
			toolCalls: runStep.toolCalls,
			toolResults: runStep.toolResults,
			inputTokens: runStep.inputTokens,
			outputTokens: runStep.outputTokens,
			createdAt: runStep.createdAt,
		})
		.from(runStep)
		.innerJoin(run, eq(run.id, runStep.runId))
		.where(and(eq(run.id, runId), eq(run.userId, userId)))
		.orderBy(asc(runStep.stepIndex));
}

export type RunContext = {
	run: {
		id: string;
		chatId: string;
		userId: string;
		model: string;
		verify: boolean;
		record: boolean;
		reasoning: ReasoningLevel;
	};
	chat: {
		id: string;
		baseBranch: string;
		workingBranch: string | null;
		pullRequestNumber: number | null;
		pullRequestUrl: string | null;
	};
	project: {
		id: string;
		fullName: string;
		installationId: number | null;
		installCommand: string | null;
		testCommand: string | null;
		startCommand: string | null;
		appPort: number | null;
	};
	/** The conversation up to and including the message this run answers. */
	messages: { role: "user" | "assistant"; content: string }[];
	envVars: { name: string; valueEncrypted: string }[];
};

// For the worker, which acts for the system rather than a signed-in user, so
// nothing here is filtered by owner.
export async function loadRunContext(db: Db, runId: string): Promise<RunContext | null> {
	const [row] = await db
		.select({
			run: {
				id: run.id,
				chatId: run.chatId,
				userId: run.userId,
				model: run.model,
				verify: run.verify,
				record: run.record,
				reasoning: run.reasoning,
			},
			chat: {
				id: chat.id,
				baseBranch: chat.baseBranch,
				workingBranch: chat.workingBranch,
				pullRequestNumber: chat.pullRequestNumber,
				pullRequestUrl: chat.pullRequestUrl,
			},
			project: {
				id: project.id,
				fullName: project.fullName,
				installationId: project.installationId,
				installCommand: project.installCommand,
				testCommand: project.testCommand,
				startCommand: project.startCommand,
				appPort: project.appPort,
			},
		})
		.from(run)
		.innerJoin(chat, eq(chat.id, run.chatId))
		.innerJoin(project, eq(project.id, chat.projectId))
		.where(eq(run.id, runId));
	if (!row) return null;

	const messages = await db
		.select({ role: message.role, content: message.content })
		.from(message)
		.where(
			and(
				eq(message.chatId, row.run.chatId),
				sql`(${message.createdAt}, ${message.id}) <= (select m.created_at, m.id from message m join run r on r.message_id = m.id where r.id = ${runId})`,
			),
		)
		.orderBy(asc(message.createdAt), asc(message.id));

	const envVars = await db
		.select({ name: projectEnvVar.name, valueEncrypted: projectEnvVar.valueEncrypted })
		.from(projectEnvVar)
		.where(eq(projectEnvVar.projectId, row.project.id))
		.orderBy(asc(projectEnvVar.name));

	return { ...row, messages, envVars };
}

export async function setPullRequest(db: Db, chatId: string, pr: { number: number; url: string }) {
	await db
		.update(chat)
		.set({ pullRequestNumber: pr.number, pullRequestUrl: pr.url, pullRequestError: null })
		.where(eq(chat.id, chatId));
}

export async function setPullRequestError(db: Db, chatId: string, error: string | null) {
	await db.update(chat).set({ pullRequestError: error }).where(eq(chat.id, chatId));
}

export async function setWorkingBranchIfUnset(db: Db, chatId: string, branch: string) {
	await db
		.update(chat)
		.set({ workingBranch: branch })
		.where(and(eq(chat.id, chatId), isNull(chat.workingBranch)));
}

export async function setChangedFiles(
	db: Db,
	runId: string,
	files: ChangedFile[],
	attempt?: number,
) {
	await db
		.update(run)
		.set({ changedFiles: files, updatedAt: new Date() })
		.where(
			and(
				eq(run.id, runId),
				eq(run.status, "running"),
				attempt === undefined ? undefined : eq(run.attempts, attempt),
			),
		);
}

/** What an earlier attempt already did, so a restarted run continues instead of starting over. */
export async function getRunProgress(db: Db, runId: string) {
	const [row] = await db
		.select({ inputTokens: run.inputTokens, outputTokens: run.outputTokens })
		.from(run)
		.where(eq(run.id, runId));
	const [{ steps } = { steps: 0 }] = await db
		.select({ steps: sql<number>`count(*)::int` })
		.from(runStep)
		.where(eq(runStep.runId, runId));
	return { steps, tokens: (row?.inputTokens ?? 0) + (row?.outputTokens ?? 0) };
}

export async function setVerification(
	db: Db,
	runId: string,
	verification: RunVerification,
	attempt?: number,
) {
	await db
		.update(run)
		.set({ verification, updatedAt: new Date() })
		.where(
			and(
				eq(run.id, runId),
				eq(run.status, "running"),
				attempt === undefined ? undefined : eq(run.attempts, attempt),
			),
		);
}

export async function setRecording(
	db: Db,
	runId: string,
	recording: RunRecording,
	attempt?: number,
) {
	const rows = await db
		.update(run)
		.set({ recording, updatedAt: new Date() })
		.where(
			and(
				eq(run.id, runId),
				eq(run.status, "running"),
				attempt === undefined ? undefined : eq(run.attempts, attempt),
			),
		)
		.returning({ id: run.id });
	return rows.length > 0;
}

/** Shows what the model is writing. Ignored once the run or the attempt has moved on. */
export async function setRunLive(db: Db, runId: string, live: RunLive | null, attempt: number) {
	await db
		.update(run)
		.set({ live })
		.where(and(eq(run.id, runId), eq(run.status, "running"), eq(run.attempts, attempt)));
}

/** For the owner's chat page. Null when the run is not theirs. */
export async function getRunLive(db: Db, userId: string, chatId: string, runId: string) {
	const [row] = await db
		.select({ status: run.status, live: run.live })
		.from(run)
		.where(and(eq(run.id, runId), eq(run.chatId, chatId), eq(run.userId, userId)));
	return row ?? null;
}

/** Proof of life. False means this attempt is no longer the current one, so the worker must stop. */
export async function touchRun(db: Db, runId: string, attempt: number) {
	const rows = await db
		.update(run)
		.set({ heartbeatAt: new Date() })
		.where(and(eq(run.id, runId), eq(run.status, "running"), eq(run.attempts, attempt)))
		.returning({ id: run.id });
	return rows.length > 0;
}

export type SweptRun = { id: string; chatId: string; action: "requeued" | "failed" | "cancelled" };

// A running run whose heartbeat stopped belongs to a crashed worker. Requeue it so the
// next attempt resumes from the saved branch; give up after maxAttempts starts.
export async function sweepStaleRuns(
	db: Db,
	options: { staleMs: number; maxAttempts: number },
) {
	const cutoff = new Date(Date.now() - options.staleMs);
	const candidates = await db
		.select({ id: run.id, chatId: run.chatId })
		.from(run)
		.where(
			and(
				eq(run.status, "running"),
				sql`coalesce(${run.heartbeatAt}, ${run.startedAt}, ${run.updatedAt}) < ${cutoff.toISOString()}::timestamptz`,
			),
		);

	const swept: SweptRun[] = [];
	for (const candidate of candidates) {
		const result = await db.transaction(async (tx): Promise<SweptRun | null> => {
			await tx.select({ id: chat.id }).from(chat).where(eq(chat.id, candidate.chatId)).for("update");
			const [current] = await tx
				.select({
					status: run.status,
					attempts: run.attempts,
					stopRequestedAt: run.stopRequestedAt,
					heartbeatAt: run.heartbeatAt,
					startedAt: run.startedAt,
					updatedAt: run.updatedAt,
				})
				.from(run)
				.where(eq(run.id, candidate.id))
				.for("update");
			if (!current || current.status !== "running") return null;
			const lastSeen = current.heartbeatAt ?? current.startedAt ?? current.updatedAt;
			if (lastSeen.getTime() >= cutoff.getTime()) return null;

			const now = new Date();
			const base = { id: candidate.id, chatId: candidate.chatId };
			if (current.stopRequestedAt) {
				await tx
					.update(run)
					.set({ status: "cancelled", stopReason: "aborted", finishedAt: now, updatedAt: now })
					.where(eq(run.id, candidate.id));
				return { ...base, action: "cancelled" };
			}
			if (current.attempts >= options.maxAttempts) {
				await tx
					.update(run)
					.set({
						status: "failed",
						stopReason: "error",
						error: `The worker stopped responding ${current.attempts} times in a row, so the run was given up.`,
						finishedAt: now,
						updatedAt: now,
					})
					.where(eq(run.id, candidate.id));
				return { ...base, action: "failed" };
			}
			await tx
				.update(run)
				.set({ status: "queued", updatedAt: now })
				.where(eq(run.id, candidate.id));
			return { ...base, action: "requeued" };
		});
		if (result) swept.push(result);
	}
	return swept;
}

// Queued runs nobody picked up (the trigger was lost): only the next run of each chat,
// since the rest wait their turn anyway.
export async function listStalledQueued(db: Db, options: { olderThanMs: number }) {
	const cutoff = new Date(Date.now() - options.olderThanMs);
	return db
		.selectDistinctOn([run.chatId], { id: run.id, chatId: run.chatId })
		.from(run)
		.where(eq(run.status, "queued"))
		.orderBy(run.chatId, asc(run.createdAt), asc(run.id))
		.then(async (nextPerChat) => {
			if (nextPerChat.length === 0) return [];
			const stale = await db
				.select({ id: run.id })
				.from(run)
				.where(
					and(
						inArray(
							run.id,
							nextPerChat.map((row) => row.id),
						),
						sql`${run.updatedAt} < ${cutoff.toISOString()}::timestamptz`,
					),
				);
			const ids = new Set(stale.map((row) => row.id));
			return nextPerChat.filter((row) => ids.has(row.id));
		});
}

// Asking twice is fine. Only the owner can stop their own running run.
export async function requestStop(db: Db, userId: string, runId: string) {
	const rows = await db
		.update(run)
		.set({ stopRequestedAt: sql`coalesce(${run.stopRequestedAt}, now())` })
		.where(and(eq(run.id, runId), eq(run.userId, userId), eq(run.status, "running")))
		.returning({ id: run.id });
	return rows.length === 1;
}

export async function isStopRequested(db: Db, runId: string) {
	const [row] = await db
		.select({ stopRequestedAt: run.stopRequestedAt })
		.from(run)
		.where(eq(run.id, runId));
	return row?.stopRequestedAt != null;
}

export type EarlierRun = {
	id: string;
	/** The message that run answered. */
	request: string;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	actions: {
		name: string;
		/** The call's main argument: a path, command or pattern. */
		target: string;
		isError: boolean;
		/** The end of the result. */
		ending: string;
	}[];
};

const EARLIER_RUNS = 10;

/**
 * What the agent did in this chat before now: earlier runs, and this run's own saved steps if
 * it was restarted. Oldest first. For the worker, so not filtered by owner.
 */
export async function loadEarlierWork(db: Db, runId: string): Promise<EarlierRun[]> {
	const runs = await db
		.select({ id: run.id, status: run.status, request: sql<string>`left(${message.content}, 300)` })
		.from(run)
		.innerJoin(message, eq(message.id, run.messageId))
		.where(
			and(
				sql`${run.chatId} = (select r.chat_id from run r where r.id = ${runId})`,
				sql`(${run.createdAt}, ${run.id}) <= (select r.created_at, r.id from run r where r.id = ${runId})`,
			),
		)
		.orderBy(desc(run.createdAt), desc(run.id))
		.limit(EARLIER_RUNS);
	if (runs.length === 0) return [];

	// Cut in SQL, so long outputs never leave the database.
	const steps = await db
		.select({
			runId: runStep.runId,
			actions: sql<EarlierRun["actions"]>`coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'name', c.call->>'name',
						'target', left(coalesce(c.call->'input'->>'path', c.call->'input'->>'command', c.call->'input'->>'pattern', ''), 200),
						'isError', coalesce((r.result->>'isError')::boolean, false),
						'ending', right(coalesce(r.result->>'output', ''), 300)
					) order by c.ord
				)
				from jsonb_array_elements(${runStep.toolCalls}) with ordinality as c(call, ord)
				left join lateral (
					select result from jsonb_array_elements(${runStep.toolResults}) as result
					where result->>'id' = c.call->>'id' limit 1
				) r on true
			), '[]'::jsonb)`,
		})
		.from(runStep)
		.where(inArray(runStep.runId, runs.map((row) => row.id)))
		.orderBy(asc(runStep.runId), asc(runStep.stepIndex));

	return runs
		.reverse()
		.map((row) => ({
			...row,
			actions: steps.filter((step) => step.runId === row.id).flatMap((step) => step.actions),
		}))
		.filter((row) => row.actions.length > 0);
}

export type ActivityCall = { id: string; name: string; label: string };
export type ActivityResult = { id: string; isError: boolean; preview: string };
export type ActivityStep = {
	runId: string;
	stepIndex: number;
	finishReason: string;
	text: string;
	/** The start and end of the model's thinking, if it shared any. */
	reasoning: string;
	calls: ActivityCall[];
	results: ActivityResult[];
	inputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

// What the chat page shows, clipped in SQL so a long run does not send megabytes
// of tool output to the page on every refresh.
export async function listRunActivity(
	db: Db,
	userId: string,
	runIds: string[],
): Promise<ActivityStep[]> {
	if (runIds.length === 0) return [];

	return db
		.select({
			runId: runStep.runId,
			stepIndex: runStep.stepIndex,
			finishReason: runStep.finishReason,
			text: sql<string>`left(${runStep.text}, 600)`,
			reasoning: sql<string>`left(${runStep.reasoning}, 4000)`,
			calls: sql<ActivityCall[]>`coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'id', t.c->>'id',
						'name', t.c->>'name',
						'label', left(coalesce(t.c->'input'->>'path', t.c->'input'->>'command', t.c->'input'->>'pattern', ''), 160)
					) order by t.ord
				)
				from jsonb_array_elements(${runStep.toolCalls}) with ordinality as t(c, ord)
			), '[]'::jsonb)`,
			results: sql<ActivityResult[]>`coalesce((
				select jsonb_agg(
					jsonb_build_object(
						'id', t.c->>'id',
						'isError', (t.c->>'isError')::boolean,
						'preview', left(t.c->>'output', 400)
					) order by t.ord
				)
				from jsonb_array_elements(${runStep.toolResults}) with ordinality as t(c, ord)
			), '[]'::jsonb)`,
			inputTokens: runStep.inputTokens,
			outputTokens: runStep.outputTokens,
			reasoningTokens: runStep.reasoningTokens,
		})
		.from(runStep)
		.innerJoin(run, eq(run.id, runStep.runId))
		.where(and(inArray(runStep.runId, runIds), eq(run.userId, userId)))
		.orderBy(asc(runStep.runId), asc(runStep.stepIndex));
}
