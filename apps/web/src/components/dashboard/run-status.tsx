import type { RunStatus } from "@nullfuse/db";

const label: Record<RunStatus, string> = {
	queued: "Queued",
	running: "Running",
	succeeded: "Done",
	failed: "Failed",
	cancelled: "Cancelled",
};

const dot: Record<RunStatus, string> = {
	queued: "bg-subtle",
	running: "bg-blue",
	succeeded: "bg-green",
	failed: "bg-red",
	cancelled: "bg-subtle",
};

// A chat that has no runs yet shows a hollow dot (status null).
export function RunStatusDot({ status }: { status: RunStatus | null }) {
	return (
		<span
			aria-hidden="true"
			className={`size-2 shrink-0 ${status ? dot[status] : "bg-border"} ${
				status === "running" ? "animate-pulse" : ""
			}`}
		/>
	);
}

export function RunStatusBadge({
	status,
	ahead = 0,
}: {
	status: RunStatus;
	ahead?: number;
}) {
	return (
		<span
			className={`inline-flex shrink-0 items-center gap-2 text-sm ${
				status === "failed" ? "text-red" : "text-muted"
			}`}
		>
			<RunStatusDot status={status} />
			{status === "queued" && ahead > 0
				? `Queued (${ahead} ahead)`
				: label[status]}
		</span>
	);
}
