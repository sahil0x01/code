import { eq, sql } from "drizzle-orm";
import type { Db } from "./index";
import {
	account,
	chat,
	installation,
	message,
	project,
	projectEnvVar,
	run,
	runStep,
	session,
	user,
	userModel,
	userPreference,
	waitlist,
} from "./schema";

export async function exportAccountData(db: Db, userId: string) {
	const [profile] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			emailVerified: user.emailVerified,
			image: user.image,
			createdAt: user.createdAt,
		})
		.from(user)
		.where(eq(user.id, userId));

	if (!profile) return null;

	const logins = await db
		.select({
			provider: account.providerId,
			providerAccountId: account.accountId,
			scope: account.scope,
			createdAt: account.createdAt,
		})
		.from(account)
		.where(eq(account.userId, userId));

	const sessions = await db
		.select({
			createdAt: session.createdAt,
			expiresAt: session.expiresAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent,
		})
		.from(session)
		.where(eq(session.userId, userId));

	const waitlistEntries = await db
		.select({ email: waitlist.email, createdAt: waitlist.createdAt })
		.from(waitlist)
		.where(eq(waitlist.email, profile.email));

	const [preferences] = await db
		.select({
			notifyRunFinished: userPreference.notifyRunFinished,
			notifyRunFailed: userPreference.notifyRunFailed,
			updatedAt: userPreference.updatedAt,
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId));

	const installations = await db
		.select({
			githubInstallationId: installation.id,
			accountLogin: installation.accountLogin,
			accountType: installation.accountType,
			repositorySelection: installation.repositorySelection,
			suspendedAt: installation.suspendedAt,
			createdAt: installation.createdAt,
		})
		.from(installation)
		.where(eq(installation.userId, userId));

	const projects = await db
		.select({
			id: project.id,
			githubRepoId: project.githubRepoId,
			fullName: project.fullName,
			defaultBranch: project.defaultBranch,
			isPrivate: project.isPrivate,
			connected: sql<boolean>`${project.installationId} is not null`,
			createdAt: project.createdAt,
			installCommand: project.installCommand,
			testCommand: project.testCommand,
			startCommand: project.startCommand,
			appPort: project.appPort,
		})
		.from(project)
		.where(eq(project.userId, userId));

	const envVarNames = await db
		.select({
			projectId: projectEnvVar.projectId,
			name: projectEnvVar.name,
			updatedAt: projectEnvVar.updatedAt,
		})
		.from(projectEnvVar)
		.innerJoin(project, eq(project.id, projectEnvVar.projectId))
		.where(eq(project.userId, userId));

	const chats = await db
		.select({
			id: chat.id,
			projectId: chat.projectId,
			title: chat.title,
			baseBranch: chat.baseBranch,
			workingBranch: chat.workingBranch,
			issueNumber: chat.issueNumber,
			pullRequestNumber: chat.pullRequestNumber,
			pullRequestUrl: chat.pullRequestUrl,
			seenAt: chat.seenAt,
			doneAt: chat.doneAt,
			createdAt: chat.createdAt,
			updatedAt: chat.updatedAt,
		})
		.from(chat)
		.where(eq(chat.userId, userId));

	const messages = await db
		.select({
			id: message.id,
			chatId: message.chatId,
			role: message.role,
			content: message.content,
			createdAt: message.createdAt,
		})
		.from(message)
		.innerJoin(chat, eq(chat.id, message.chatId))
		.where(eq(chat.userId, userId));

	const runs = await db
		.select({
			id: run.id,
			chatId: run.chatId,
			messageId: run.messageId,
			model: run.model,
			modelLabel: run.modelLabel,
			status: run.status,
			stopReason: run.stopReason,
			error: run.error,
			changedFiles: run.changedFiles,
			verify: run.verify,
			record: run.record,
			recording: run.recording,
			verification: run.verification,
			reasoning: run.reasoning,
			cachedInputTokens: run.cachedInputTokens,
			reasoningTokens: run.reasoningTokens,
			inputTokens: run.inputTokens,
			outputTokens: run.outputTokens,
			modelCost: run.modelCost,
			sandboxCost: run.sandboxCost,
			updateBase: run.updateBase,
			planOnly: run.planOnly,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			createdAt: run.createdAt,
		})
		.from(run)
		.where(eq(run.userId, userId));

	const runSteps = await db
		.select({
			id: runStep.id,
			runId: runStep.runId,
			stepIndex: runStep.stepIndex,
			finishReason: runStep.finishReason,
			text: runStep.text,
			reasoning: runStep.reasoning,
			cachedInputTokens: runStep.cachedInputTokens,
			reasoningTokens: runStep.reasoningTokens,
			toolCalls: runStep.toolCalls,
			toolResults: runStep.toolResults,
			inputTokens: runStep.inputTokens,
			outputTokens: runStep.outputTokens,
			cost: runStep.cost,
			createdAt: runStep.createdAt,
		})
		.from(runStep)
		.innerJoin(run, eq(run.id, runStep.runId))
		.where(eq(run.userId, userId));

	const models = await db
		.select({
			id: userModel.id,
			provider: userModel.provider,
			modelId: userModel.modelId,
			label: userModel.label,
			baseUrl: userModel.baseUrl,
			keyLast4: userModel.keyLast4,
			createdAt: userModel.createdAt,
		})
		.from(userModel)
		.where(eq(userModel.userId, userId));

	return {
		exportedAt: new Date().toISOString(),
		profile,
		logins,
		sessions,
		waitlist: waitlistEntries,
		preferences: preferences ?? null,
		installations,
		projects,
		envVarNames,
		chats,
		messages,
		runs,
		runSteps,
		models,
	};
}

export async function deleteWaitlistEntry(db: Db, email: string) {
	await db.delete(waitlist).where(eq(waitlist.email, email));
}
