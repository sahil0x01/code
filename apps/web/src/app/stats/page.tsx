import { connection } from "next/server";
import { Suspense } from "react";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { DailyBars } from "@/components/stats/daily-bars";
import { StatGrid, StatSection, StatTile } from "@/components/stats/stat-tile";
import { formatCount, formatDay, formatHours, formatPercent } from "@/lib/format-stats";
import { loadPublicStats } from "@/server/public-stats";

export const metadata = {
	title: "Stats",
	description: "What the agent has done so far, counted from real runs and updated every hour.",
};

export default function StatsPage() {
	return (
		<>
			<Header />
			<main className="mx-auto flex max-w-5xl flex-col gap-10 px-6 py-16 md:py-20">
				<header className="flex flex-col gap-2">
					<h1 className="text-3xl font-semibold tracking-tight">Stats</h1>
					<p className="max-w-2xl text-muted">
						What the agent has done so far, counted from real runs. Totals only: nothing here
						points to a person or a repository.
					</p>
				</header>
				<Suspense fallback={<StatsSkeleton />}>
					<PublicStats />
				</Suspense>
			</main>
			<Footer />
		</>
	);
}

async function PublicStats() {
	await connection();
	const { totals, rates, daily, generatedAt } = await loadPublicStats();
	const tokens = totals.inputTokens + totals.outputTokens;

	return (
		<>
			<StatSection title="Work done">
				<StatGrid>
					<StatTile label="Agent runs" value={formatCount(totals.runsStarted)} />
					<StatTile label="Pull requests opened" value={formatCount(totals.pullRequestsOpened)} />
					<StatTile
						label="Pull requests merged"
						value={formatCount(totals.pullRequestsMerged)}
						note={`${formatPercent(rates.pullRequestsMerged)} of those opened`}
					/>
					<StatTile
						label="Lines in merged PRs"
						value={formatCount(totals.linesAdded + totals.linesRemoved)}
						note={`+${formatCount(totals.linesAdded)} −${formatCount(totals.linesRemoved)}`}
					/>
					<StatTile label="Hours of agent work" value={formatHours(totals.agentSeconds)} />
					<StatTile label="Tool calls" value={formatCount(totals.toolCalls)} />
					<StatTile label="Files changed" value={formatCount(totals.fileEdits)} note="Counted once per run" />
					<StatTile label="Repositories" value={formatCount(totals.projectsConnected)} />
				</StatGrid>
			</StatSection>

			<StatSection title="Quality">
				<StatGrid>
					<StatTile
						label="Runs that finished"
						value={formatPercent(rates.runSuccess)}
						note="Succeeded, of succeeded and failed"
					/>
					<StatTile
						label="Tests passed"
						value={formatPercent(rates.testsPassed)}
						note={`Of ${formatCount(totals.runsVerified)} runs that ran them`}
					/>
					<StatTile label="Tokens processed" value={formatCount(tokens)} />
					<StatTile
						label="Input from cache"
						value={formatPercent(rates.cachedInput)}
						note="Cheaper and faster for the model"
					/>
				</StatGrid>
			</StatSection>

			<StatSection title="Last 90 days">
				<div className="grid gap-3 md:grid-cols-2">
					<DailyBars
						title="Agent runs per day"
						unit="runs"
						format={formatCount}
						points={daily.map((row) => ({ day: row.day, value: row.runsStarted }))}
					/>
					<DailyBars
						title="Pull requests opened per day"
						unit="pull requests"
						format={formatCount}
						points={daily.map((row) => ({ day: row.day, value: row.pullRequestsOpened }))}
					/>
				</div>
			</StatSection>

			<p className="font-mono text-xs text-subtle">
				{totals.since ? `Counted since ${formatDay(totals.since)}. ` : ""}
				Updated {new Date(generatedAt).toUTCString()}. Also at{" "}
				<a href="/api/stats" className="underline hover:text-foreground">
					/api/stats
				</a>
				.
			</p>
		</>
	);
}

function StatsSkeleton() {
	return (
		<div aria-hidden="true" className="grid grid-cols-2 gap-3 md:grid-cols-4">
			{Array.from({ length: 8 }, (_, index) => (
				<div key={index} className="pixel-inset h-24 animate-pulse bg-surface" />
			))}
		</div>
	);
}
