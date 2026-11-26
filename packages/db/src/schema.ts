import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	bigint,
	boolean,
	check,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

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
		pullRequestNumber: integer("pull_request_number"),
		pullRequestUrl: text("pull_request_url"),
		// Why the last attempt to open the PR failed, shown to the user.
		pullRequestError: text("pull_request_error"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [index("chat_project_updated_idx").on(t.projectId, t.updatedAt)],
);

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

export const runStopReasons = [
	"completed",
	"step-limit",
	"token-budget",
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
		verify: boolean("verify").notNull().default(false),
		verification: jsonb("verification").$type<RunVerification>(),
		heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
		attempts: integer("attempts").notNull().default(0),
		inputTokens: integer("input_tokens").notNull().default(0),
		outputTokens: integer("output_tokens").notNull().default(0),
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
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [unique("run_step_run_index_unique").on(t.runId, t.stepIndex)],
);
