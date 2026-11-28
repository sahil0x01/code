import { getUserStats } from "@nullfuse/db";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { DailyBars } from "@/components/stats/daily-bars";
import { StatGrid, StatSection, StatTile } from "@/components/stats/stat-tile";
import {
	formatCount,
	formatHours,
	formatMicroDollars,
	formatPercent,
} from "@/lib/format-stats";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export const metadata = { title: "Stats" };

const DAYS = 30;

const rate = (part: number, whole: number) => (whole > 0 ? part / whole : null);

export default async function UserStatsPage() {
	const session = await requireSession();
	const { totals, byModel, daily } = await getUserStats(db, session.user.id, DAYS);

	const header = (
		<PageHeader title="Stats" description="Everything your runs have done, from your own data." />
	);

	if (totals.runsStarted === 0) {
		return (
			<div className="flex flex-col gap-6">
				{header}
				<EmptyState
					title="No runs yet"
					description="Start a chat and your runs, tokens and pull requests are counted here."
					action={{ label: "New chat", href: "/dashboard/chats/new" }}
				/>
			</div>
		);
	}

	const tokens = totals.inputTokens + totals.outputTokens;
	const finished = totals.runsSucceeded + totals.runsFailed;

	return (
		<div className="flex flex-col gap-8">
			{header}

			<StatSection title="Work">
				<StatGrid>
					<StatTile
						label="Runs"
						value={formatCount(totals.runsStarted)}
						note={`${formatCount(totals.chats)} chats · ${formatCount(totals.projects)} projects`}
					/>
					<StatTile
						label="Runs that finished"
						value={formatPercent(rate(totals.runsSucceeded, finished))}
						note={`${formatCount(totals.runsFailed)} failed · ${formatCount(totals.runsCancelled)} stopped`}
					/>
					<StatTile label="Agent time" value={formatHours(totals.agentSeconds)} />
					<StatTile
						label="Tests passed"
						value={formatPercent(rate(totals.runsVerifiedPassed, totals.runsVerified))}
						note={`Of ${formatCount(totals.runsVerified)} runs that ran them`}
					/>
					<StatTile label="Pull requests opened" value={formatCount(totals.pullRequestsOpened)} />
					<StatTile label="Pull requests merged" value={formatCount(totals.pullRequestsMerged)} />
					<StatTile
						label="Lines in merged PRs"
						value={formatCount(totals.linesAdded + totals.linesRemoved)}
						note={`+${formatCount(totals.linesAdded)} −${formatCount(totals.linesRemoved)}`}
					/>
					<StatTile
						label="Tool calls"
						value={formatCount(totals.toolCalls)}
						note={`Over ${formatCount(totals.steps)} model steps`}
					/>
				</StatGrid>
			</StatSection>

			<StatSection title="Tokens">
				<StatGrid>
					<StatTile label="Total" value={formatCount(tokens)} />
					<StatTile
						label="Input"
						value={formatCount(totals.inputTokens)}
						note={`${formatPercent(rate(totals.cachedInputTokens, totals.inputTokens))} from cache`}
					/>
					<StatTile label="Output" value={formatCount(totals.outputTokens)} />
					<StatTile
						label="Thinking"
						value={formatCount(totals.reasoningTokens)}
						note="Part of the output"
					/>
				</StatGrid>
			</StatSection>

			<StatSection title="Estimated cost">
				<StatGrid>
					<StatTile label="Models" value={formatMicroDollars(totals.modelCost)} />
					<StatTile label="Sandboxes" value={formatMicroDollars(totals.sandboxCost)} />
					<StatTile label="Total" value={formatMicroDollars(totals.modelCost + totals.sandboxCost)} />
					<StatTile
						label="Per run"
						value={formatMicroDollars((totals.modelCost + totals.sandboxCost) / totals.runsStarted)}
					/>
				</StatGrid>
				<p className="text-xs text-subtle">
					Worked out from list prices. With your own model key, your provider bills the model
					part and its numbers are the ones that count.
				</p>
			</StatSection>

			<StatSection title={`Last ${DAYS} days`}>
				<div className="grid gap-3 md:grid-cols-2">
					<DailyBars
						title="Runs per day"
						unit="runs"
						format={formatCount}
						points={daily.map((row) => ({ day: row.day, value: row.runs }))}
					/>
					<DailyBars
						title="Tokens per day"
						unit="tokens"
						format={formatCount}
						points={daily.map((row) => ({ day: row.day, value: row.tokens }))}
					/>
				</div>
			</StatSection>

			<StatSection title="By model">
				<div className="pixel-inset relative overflow-x-auto bg-surface">
					<table className="w-full text-sm">
						<thead>
							<tr className="text-left font-mono text-xs text-subtle">
								<th className="px-4 py-2 font-normal">Model</th>
								<th className="px-4 py-2 text-right font-normal">Runs</th>
								<th className="px-4 py-2 text-right font-normal">Tokens</th>
								<th className="px-4 py-2 text-right font-normal">Est. cost</th>
							</tr>
						</thead>
						<tbody className="tabular-nums">
							{byModel.map((row) => (
								<tr key={row.model} className="border-t border-border">
									<td className="px-4 py-2 font-mono text-xs">{row.model}</td>
									<td className="px-4 py-2 text-right">{formatCount(row.runs)}</td>
									<td className="px-4 py-2 text-right">{formatCount(row.tokens)}</td>
									<td className="px-4 py-2 text-right">{formatMicroDollars(row.modelCost)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</StatSection>
		</div>
	);
}
