export type CheckState = "pending" | "passed" | "failed" | "skipped";

export type Check = {
	key: string;
	/** Set for check runs, which can be sent to the agent. Commit statuses have none. */
	checkRunId: number | null;
	name: string;
	state: CheckState;
	url: string | null;
};

export type PullStatus = {
	state: "ok";
	number: number;
	url: string;
	headSha: string;
	status: "open" | "draft" | "merged" | "closed";
	/** Why an open PR cannot be merged right now, or null when it can. */
	blocker: string | null;
	checks: Check[];
	/** GitHub refused to list some checks, usually a missing app permission. */
	checksUnavailable: boolean;
	deployments: { id: number; name: string; url: string }[];
};

export type PullResponse = PullStatus | { state: "none" } | { state: "disconnected" };

export function summarizeChecks(checks: Check[]) {
	const count = (state: CheckState) => checks.filter((check) => check.state === state).length;
	const failed = count("failed");
	const pending = count("pending");
	if (failed > 0) return { tone: "failed" as const, text: `${failed} of ${checks.length} checks failed` };
	if (pending > 0) return { tone: "pending" as const, text: `${pending} of ${checks.length} checks running` };
	if (checks.length === 0) return { tone: "skipped" as const, text: "No checks" };
	return { tone: "passed" as const, text: "Checks passed" };
}
