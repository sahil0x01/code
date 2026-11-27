"use client";

import { useState } from "react";
import { PixelIcon } from "@/components/ui/pixel-icon";
import { buttonClass, field } from "@/components/ui/styles";
import { Tooltip } from "@/components/ui/tooltip";
import type { IssueSummary } from "@/lib/issue";
import type { IssueResponse } from "@/lib/issue-handler";

type Props = {
	projectId: string;
	onPick(issue: IssueResponse): void;
};

async function get<T>(url: string): Promise<T> {
	const response = await fetch(url, { cache: "no-store" });
	const body = await response.json();
	if (!response.ok) throw new Error(body.error);
	return body;
}

/** Fills the message from an open issue. Give it the project as its key, so a change resets it. */
export function IssuePicker({ projectId, onPick }: Props) {
	const [issues, setIssues] = useState<IssueSummary[] | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const url = `/api/projects/${projectId}/issues`;

	const run = async (task: () => Promise<void>) => {
		setBusy(true);
		setError(null);
		try {
			await task();
		} catch (failure) {
			setError(failure instanceof Error && failure.message ? failure.message : "Something went wrong. Try again.");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="flex flex-wrap items-center gap-3">
			{issues === null ? (
				<Tooltip hint="Fill the message from an open GitHub issue" align="start">
					<button
						type="button"
						disabled={busy}
						onClick={() => run(async () => setIssues((await get<{ issues: IssueSummary[] }>(url)).issues))}
						className={`${buttonClass("secondary", "sm")} gap-2`}
					>
						<PixelIcon name="issue" />
						{busy ? "Loading..." : "From an issue"}
					</button>
				</Tooltip>
			) : issues.length === 0 ? (
				<p className="text-sm text-muted">This repository has no open issues.</p>
			) : (
				<select
					aria-label="Issue"
					defaultValue=""
					disabled={busy}
					onChange={(event) => {
						const number = event.target.value;
						if (number) run(async () => onPick(await get<IssueResponse>(`${url}?number=${number}`)));
					}}
					className={`${field} min-w-0 max-w-full`}
				>
					<option value="">Choose an issue</option>
					{issues.map((issue) => (
						<option key={issue.number} value={issue.number}>
							#{issue.number} {issue.title}
						</option>
					))}
				</select>
			)}
			{error && (
				<p role="alert" className="text-sm text-red">
					{error}
				</p>
			)}
		</div>
	);
}
