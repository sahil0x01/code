import {
	claimReports,
	type ConnectorProvider,
	type Db,
	finishReport,
	type PendingReport,
	releaseReport,
} from "@nullfuse/db";
import { escapeDiscord } from "./discord";
import { escapeGitHub } from "./github";
import { clip } from "./http";
import { escapeSlack } from "./slack";

const plain = (text: string) => text;

// Each tool's limit on one message is above these, with room for the links.
const STYLES: Record<ConnectorProvider, { bold(text: string): string; escape(text: string): string; answer: number }> = {
	slack: { bold: (text) => `*${text}*`, escape: escapeSlack, answer: 2000 },
	discord: { bold: (text) => `**${text}**`, escape: escapeDiscord, answer: 1200 },
	telegram: { bold: plain, escape: plain, answer: 2500 },
	github: { bold: (text) => `**${text}**`, escape: escapeGitHub, answer: 5000 },
};

const HEADLINES = {
	succeeded: "Done",
	failed: "Failed",
	cancelled: "Stopped",
} as const;

export function reportText(report: PendingReport, appUrl: string | undefined) {
	const style = STYLES[report.provider];
	const lines = [
		`${style.bold(`${HEADLINES[report.status]}:`)} ${style.escape(report.chatTitle)} (${style.escape(report.projectName)})`,
	];
	const body = (report.status === "failed" ? (report.error ?? report.answer) : report.answer)?.trim();
	// Escaped after clipping, so a cut never leaves half an escape.
	if (body) lines.push(style.escape(clip(body, style.answer)));
	if (report.pullRequestUrl) lines.push(`Pull request: ${report.pullRequestUrl}`);
	else if (report.pullRequestError) {
		lines.push(`The pull request could not be opened: ${style.escape(clip(report.pullRequestError, 300))}`);
	}
	if (appUrl) lines.push(`Review: ${new URL(`/dashboard/chats/${report.chatId}`, appUrl)}`);
	return lines.join("\n\n");
}

export type Sender = (report: PendingReport, text: string) => Promise<void>;

export type ReportDeps = {
	db: Db;
	appUrl?: string;
	/** Only tools that can be answered are listed; the others' replies wait. */
	senders: Partial<Record<ConnectorProvider, Sender>>;
};

/** Sends the replies that are owed. A failed one is tried again by a later call. */
export async function sendReports(deps: ReportDeps, options: { runId?: string } = {}) {
	const providers = Object.keys(deps.senders) as ConnectorProvider[];
	const reports = await claimReports(deps.db, { ...options, providers });
	let sent = 0;
	const failed: string[] = [];
	for (const report of reports) {
		try {
			await deps.senders[report.provider]?.(report, reportText(report, deps.appUrl));
			await finishReport(deps.db, report);
			sent++;
		} catch (error) {
			await releaseReport(deps.db, report);
			failed.push(error instanceof Error ? error.message : String(error));
		}
	}
	return { sent, failed };
}
