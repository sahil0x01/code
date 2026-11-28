import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	check,
	customType,
	date,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	text,
	timestamp,
	type AnyPgColumn,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { ProviderId } from "@nullfuse/models/providers";

export const waitlist = pgTable("waitlist", {
	id: uuid("id").primaryKey().defaultRandom(),
	email: text("email").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	token: text("token").notNull().unique(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", {
		withTimezone: true,
	}),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
		withTimezone: true,
	}),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const rateLimit = pgTable("rate_limit", {
	id: text("id").primaryKey(),
	key: text("key").notNull().unique(),
	count: integer("count").notNull(),
	lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

export const userPreference = pgTable("user_preference", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	notifyRunFinished: boolean("notify_run_finished").notNull().default(true),
	notifyRunFailed: boolean("notify_run_failed").notNull().default(true),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/** A model a user added with their own API key. */
export const userModel = pgTable(
	"user_model",
	{
		id: uuid("id").primaryKey(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ProviderId>().notNull(),
		modelId: text("model_id").notNull(),
		label: text("label").notNull(),
		baseUrl: text("base_url"),
		keyEncrypted: text("key_encrypted").notNull(),
		keyLast4: text("key_last4").notNull(),
		contextTokens: integer("context_tokens"),
		maxOutputTokens: integer("max_output_tokens"),
		// Dollars per million tokens. Null when the price is not known.
		price: jsonb("price").$type<UserModelPrice>(),
		// The most tokens one run may use. Null for the server's limit.
		maxRunTokens: integer("max_run_tokens"),
		// The user's word that a model at their own address can look at images.
		readsImages: boolean("reads_images").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		testedAt: timestamp("tested_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		index("user_model_user_idx").on(t.userId),
		unique("user_model_user_label_unique").on(t.userId, t.label),
	],
);

export type UserModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

export const installation = pgTable("installation", {
	id: bigint("id", { mode: "number" }).primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accountId: bigint("account_id", { mode: "number" }).notNull(),
	accountLogin: text("account_login").notNull(),
	accountType: text("account_type").$type<"User" | "Organization">().notNull(),
	repositorySelection: text("repository_selection")
		.$type<"all" | "selected">()
		.notNull(),
	permissions: jsonb("permissions")
		.$type<Record<string, string>>()
		.notNull()
		.default({}),
	suspendedAt: timestamp("suspended_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

export const project = pgTable(
	"project",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		installationId: bigint("installation_id", { mode: "number" }).references(
			() => installation.id,
			{ onDelete: "set null" },
		),
		githubRepoId: bigint("github_repo_id", { mode: "number" }).notNull(),
		fullName: text("full_name").notNull(),
		defaultBranch: text("default_branch").notNull(),
		isPrivate: boolean("is_private").notNull(),
		installCommand: text("install_command"),
		testCommand: text("test_command"),
		// How to run the app for a verification recording, and the port it listens on.
		startCommand: text("start_command"),
		appPort: integer("app_port"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique("project_user_repo_unique").on(t.userId, t.githubRepoId),
		index("project_installation_idx").on(t.installationId),
	],
);

export const projectEnvVar = pgTable(
	"project_env_var",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		valueEncrypted: text("value_encrypted").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		unique("project_env_var_project_name_unique").on(t.projectId, t.name),
	],
);

export const chat = pgTable(
	"chat",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		projectId: uuid("project_id")
			.notNull()
			.references(() => project.id, { onDelete: "cascade" }),
		title: text("title").notNull(),
		baseBranch: text("base_branch").notNull(),
		workingBranch: text("working_branch"),
		// The GitHub issue the chat was started from. Its pull request closes it.
		issueNumber: integer("issue_number"),
		pullRequestNumber: integer("pull_request_number"),
		pullRequestUrl: text("pull_request_url"),
		// Why the last attempt to open the PR failed, shown to the user.
		pullRequestError: text("pull_request_error"),
		// When the first PR for the chat was opened, and when GitHub reported it merged.
		pullRequestOpenedAt: timestamp("pull_request_opened_at", { withTimezone: true }),
		pullRequestMergedAt: timestamp("pull_request_merged_at", { withTimezone: true }),
		// The merged PR's size as GitHub reported it, so it may include commits people added.
		pullRequestAdditions: integer("pull_request_additions"),
		pullRequestDeletions: integer("pull_request_deletions"),
		// Runs that finished after this are unread.
		seenAt: timestamp("seen_at", { withTimezone: true }),
		// The chat needs review again once a run finishes after this.
		doneAt: timestamp("done_at", { withTimezone: true }),
		// Set while auto-fix is on. Comments written before this are left alone.
		autoFixSince: timestamp("auto_fix_since", { withTimezone: true }),
		autoFixCheckedAt: timestamp("auto_fix_checked_at", { withTimezone: true }),
		// Why auto-fix paused or turned itself off, shown to the user.
		autoFixNote: text("auto_fix_note"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("chat_project_updated_idx").on(t.projectId, t.updatedAt)],
);

export type ConnectorProvider = "slack" | "discord" | "telegram" | "github";

/** An outside account linked to a user, and the project its tasks go to. */
export const connection = pgTable(
	"connection",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		provider: text("provider").$type<ConnectorProvider>().notNull(),
		workspaceId: text("workspace_id").notNull(),
		workspaceName: text("workspace_name").notNull(),
		externalUserId: text("external_user_id").notNull(),
		projectId: uuid("project_id").references(() => project.id, { onDelete: "set null" }),
		// The token used to send results back, for tools that issue one per workspace.
		tokenEncrypted: text("token_encrypted"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		unique("connection_identity_unique").on(t.provider, t.workspaceId, t.externalUserId),
		index("connection_user_idx").on(t.userId),
	],
);

/** A task sent from an outside tool: stops it being started twice, and tracks the reply. */
export const connectorRequest = pgTable(
	"connector_request",
	{
		connectionId: uuid("connection_id")
			.notNull()
			.references(() => connection.id, { onDelete: "cascade" }),
		// The outside tool's own ID for the request.
		externalId: text("external_id").notNull(),
		runId: uuid("run_id").references((): AnyPgColumn => run.id, { onDelete: "cascade" }),
		// Where the reply goes when it is not the person themselves, such as an issue number.
		target: text("target"),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		reportedAt: timestamp("reported_at", { withTimezone: true }),
		attempts: integer("attempts").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [
		primaryKey({ columns: [t.connectionId, t.externalId] }),
		index("connector_request_run_idx").on(t.runId),
	],
);

/** A one-time code that links a chat account to the user who made it. Only its hash is kept. */
export const connectorLinkCode = pgTable("connector_link_code", {
	codeHash: text("code_hash").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	provider: text("provider").$type<ConnectorProvider>().notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const message = pgTable(
	"message",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		chatId: uuid("chat_id")
			.notNull()
			.references(() => chat.id, { onDelete: "cascade" }),
		role: text("role").$type<"user" | "assistant">().notNull(),
		content: text("content").notNull(),
		// The run that wrote an assistant message. Null for the user's messages.
		runId: uuid("run_id").references((): AnyPgColumn => run.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("message_chat_created_idx").on(t.chatId, t.createdAt),
		check("message_role_check", sql`${t.role} in ('user', 'assistant')`),
	],
);

const bytes = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/** A file sent with a message. It goes when its message or chat does. */
export const attachment = pgTable(
	"attachment",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		messageId: uuid("message_id")
			.notNull()
			.references(() => message.id, { onDelete: "cascade" }),
		position: integer("position").notNull(),
		name: text("name").notNull(),
		mediaType: text("media_type").notNull(),
		size: integer("size").notNull(),
		data: bytes("data").notNull(),
	},
	(t) => [unique("attachment_message_position_unique").on(t.messageId, t.position)],
);

export const runStopReasons = [
	"completed",
	"step-limit",
	"token-budget",
	"cost-limit",
	"timeout",
	"aborted",
	"error",
] as const;

export type RunStopReason = (typeof runStopReasons)[number];

export type RunVerification = {
	command: string;
	exitCode: number;
	timedOut: boolean;
	durationMs: number;
	/** The end of the output, with secrets removed. */
	output: string;
};

export const reasoningLevels = ["off", "low", "high", "max"] as const;
export type ReasoningLevel = (typeof reasoningLevels)[number];

/** What the model is writing right now, for the step that has not finished yet. */
export type RunLive = {
	stepIndex: number;
	reasoning: string;
	text: string;
	/** The tool whose call the model is writing. */
	tool: string | null;
};

export type RunRecording =
	| {
			status: "recorded";
			/** Where the video is in object storage. */
			key: string;
			/** The web app in use, or a page of what was run, changed and read. */
			kind?: "web" | "page";
			screenshots?: { key: string; label: string }[];
			passed: boolean;
			error: string | null;
			durationMs: number;
			bytes: number;
	  }
	| { status: "skipped"; message: string; detail: string };

export type ChangedFile = {
	path: string;
	status: "added" | "modified" | "deleted" | "renamed";
};

export const run = pgTable(
	"run",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		chatId: uuid("chat_id")
			.notNull()
			.references(() => chat.id, { onDelete: "cascade" }),
		messageId: uuid("message_id")
			.notNull()
			.references(() => message.id, { onDelete: "cascade" }),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		model: text("model").notNull(),
		// The name to show for a user's own model, kept after the model is removed.
		modelLabel: text("model_label"),
		status: text("status")
			.$type<"queued" | "running" | "succeeded" | "failed" | "cancelled">()
			.notNull()
			.default("queued"),
		startedAt: timestamp("started_at", { withTimezone: true }),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
		stopReason: text("stop_reason").$type<RunStopReason>(),
		error: text("error"),
		changedFiles: jsonb("changed_files")
			.$type<ChangedFile[]>()
			.notNull()
			.default([]),
		stopRequestedAt: timestamp("stop_requested_at", { withTimezone: true }),
		reasoning: text("reasoning").$type<ReasoningLevel>().notNull().default("high"),
		cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
		reasoningTokens: integer("reasoning_tokens").notNull().default(0),
		verify: boolean("verify").notNull().default(false),
		verification: jsonb("verification").$type<RunVerification>(),
		// Merge the latest base branch into the chat's branch before answering.
		updateBase: boolean("update_base").notNull().default(false),
		// The agent only reads and proposes; nothing is changed or pushed.
		planOnly: boolean("plan_only").notNull().default(false),
		recording: jsonb("recording").$type<RunRecording>(),
		// Started by auto-fix, not by the user.
		autoFix: boolean("auto_fix").notNull().default(false),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
		// Set while the run waits for room to start. Cleared once it has a sandbox.
		waitingSince: timestamp("waiting_since", { withTimezone: true }),
		live: jsonb("live").$type<RunLive>(),
		attempts: integer("attempts").notNull().default(0),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		// Estimates from list prices, in millionths of a dollar.
		modelCost: integer("model_cost").notNull().default(0),
		sandboxCost: integer("sandbox_cost").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("run_chat_created_idx").on(t.chatId, t.createdAt),
		index("run_user_status_idx").on(t.userId, t.status),
		uniqueIndex("run_one_running_per_chat")
			.on(t.chatId)
			.where(sql`${t.status} = 'running'`),
		check(
			"run_status_check",
			sql`${t.status} in ('queued', 'running', 'succeeded', 'failed', 'cancelled')`,
		),
		check(
			"run_stop_reason_check",
			sql`${t.stopReason} is null or ${t.stopReason} in (${sql.raw(runStopReasons.map((reason) => `'${reason}'`).join(", "))})`,
		),
	],
);

/** Failed checks, comments and conflicts already sent to the agent, so none is sent twice. */
export const autoFixSeen = pgTable(
	"auto_fix_seen",
	{
		chatId: uuid("chat_id")
			.notNull()
			.references(() => chat.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [primaryKey({ columns: [t.chatId, t.key] })],
);

export type StepToolCall = { id: string; name: string; input: unknown };

export type StepToolResult = {
	id: string;
	name: string;
	output: string;
	isError: boolean;
};

export const runStep = pgTable(
	"run_step",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		runId: uuid("run_id")
			.notNull()
			.references(() => run.id, { onDelete: "cascade" }),
		stepIndex: integer("step_index").notNull(),
		finishReason: text("finish_reason").notNull(),
		text: text("text").notNull().default(""),
		reasoning: text("reasoning").notNull().default(""),
		toolCalls: jsonb("tool_calls")
			.$type<StepToolCall[]>()
			.notNull()
			.default([]),
		toolResults: jsonb("tool_results")
			.$type<StepToolResult[]>()
			.notNull()
			.default([]),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
		cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
		reasoningTokens: integer("reasoning_tokens").notNull().default(0),
		cost: integer("cost").notNull().default(0),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [unique("run_step_run_index_unique").on(t.runId, t.stepIndex)],
);

/**
 * Videos waiting to be removed from storage. A database trigger on `run` adds a row whenever
 * a recording stops being referenced, including through a cascade, so no code path can forget.
 */
export const recordingDeletion = pgTable("recording_deletion", {
	key: text("key").primaryKey(),
	attempts: integer("attempts").notNull().default(0),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

const count = (name: string) => integer(name).notNull().default(0);
const total = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);

/**
 * What happened on each day (UTC), for public numbers. Rows hold only totals, and days older
 * than a few are never recomputed, so deleting an account does not lower past numbers.
 */
export const dailyStats = pgTable("daily_stats", {
	day: date("day", { mode: "string" }).primaryKey(),
	usersJoined: count("users_joined"),
	activeUsers: count("active_users"),
	projectsConnected: count("projects_connected"),
	chatsStarted: count("chats_started"),
	runsStarted: count("runs_started"),
	runsSucceeded: count("runs_succeeded"),
	runsFailed: count("runs_failed"),
	runsCancelled: count("runs_cancelled"),
	// Time the agent spent on finished runs.
	agentSeconds: total("agent_seconds"),
	steps: count("steps"),
	toolCalls: count("tool_calls"),
	// Files a succeeded run changed. A file changed by two runs counts twice.
	fileEdits: count("file_edits"),
	inputTokens: total("input_tokens"),
	outputTokens: total("output_tokens"),
	cachedInputTokens: total("cached_input_tokens"),
	// Estimates from list prices, in millionths of a dollar.
	modelCost: total("model_cost"),
	sandboxCost: total("sandbox_cost"),
	// Finished runs whose test command ran, and those where it passed.
	runsVerified: count("runs_verified"),
	runsVerifiedPassed: count("runs_verified_passed"),
	pullRequestsOpened: count("pull_requests_opened"),
	pullRequestsMerged: count("pull_requests_merged"),
	linesAdded: total("lines_added"),
	linesRemoved: total("lines_removed"),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
