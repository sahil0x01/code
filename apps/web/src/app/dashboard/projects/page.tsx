import { listInstallations, listProjectSummaries } from "@nullfuse/db";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { buttonClass } from "@/components/ui/styles";
import { installUrl } from "@/lib/github-app";
import { relativeTime } from "@/lib/time";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export const metadata = { title: "Projects" };

export default async function ProjectsPage({
	searchParams,
}: PageProps<"/dashboard/projects">) {
	const session = await requireSession();
	const { setup_action } = await searchParams;
	const [installations, projects] = await Promise.all([
		listInstallations(db, session.user.id),
		listProjectSummaries(db, session.user.id),
	]);

	return (
		<div className="flex flex-col gap-8">
			<PageHeader
				title="Projects"
				description="GitHub repositories the agent can work on."
				actions={
					installations.length > 0 ? (
						<Link
							href="/dashboard/projects/new"
							className={buttonClass("secondary")}
						>
							Add repositories
						</Link>
					) : null
				}
			/>

			{projects.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{projects.map((p) => {
						const [owner, ...rest] = p.fullName.split("/");
						const connected = p.installationId !== null;
						return (
							<li
								key={p.id}
								className="pixel-inset relative flex items-center justify-between gap-4 bg-surface px-4 py-3 hover:bg-surface-2"
							>
								<div className="flex min-w-0 flex-col gap-0.5">
									<Link
										href={`/dashboard/projects/${p.id}`}
										className="truncate font-medium after:absolute after:inset-0"
									>
										<span className="text-muted">{owner}/</span>
										{rest.join("/")}
									</Link>
									<span className="break-words font-mono text-xs text-muted sm:truncate">
										{p.isPrivate ? "Private" : "Public"} · {p.defaultBranch} ·{" "}
										{p.chatCount === 0
											? "no chats yet"
											: `${p.chatCount} ${p.chatCount === 1 ? "chat" : "chats"}`}
										{p.lastActivityAt
											? ` · active ${relativeTime(p.lastActivityAt)}`
											: ""}
									</span>
								</div>
								{connected ? (
									<Link
										href={`/dashboard/chats/new?project=${p.id}`}
										className={`${buttonClass("secondary", "sm")} relative z-10 shrink-0`}
									>
										New chat
									</Link>
								) : (
									<span className="shrink-0 text-sm text-red">
										Disconnected
									</span>
								)}
							</li>
						);
					})}
				</ul>
			) : null}

			{installations.length === 0 && setup_action ? (
				<EmptyState
					title="Finishing the connection"
					description="GitHub says the app is installed. We are waiting for its signed confirmation. Refresh in a few seconds."
				/>
			) : installations.length === 0 ? (
				<EmptyState
					title="Connect GitHub to add your first project"
					description="A project is a GitHub repository the agent can work on. Pick the repos you want; we only ask for the access we need."
					action={{ label: "Connect GitHub", href: installUrl() }}
				/>
			) : (
				<section className="flex flex-col gap-3">
					<h2 className="font-mono text-xs uppercase text-subtle">
						GitHub accounts
					</h2>
					<ul className="flex flex-col gap-2">
						{installations.map((i) => (
							<li
								key={i.id}
								className="flex flex-wrap items-center justify-between gap-3 border border-border px-4 py-2.5"
							>
								<span className="text-sm">
									<span className="font-medium">{i.accountLogin}</span>
									<span className="text-muted">
										{" · "}
										{i.accountType === "Organization"
											? "Organization"
											: "Personal"}
										{" · "}
										{i.repositorySelection === "all"
											? "all repositories"
											: "selected repositories"}
										{i.suspendedAt ? " · suspended" : ""}
									</span>
								</span>
								<Link
									href={`/dashboard/projects/new?installation=${i.id}`}
									className="text-sm underline"
								>
									Add repositories
								</Link>
							</li>
						))}
					</ul>
					<a href={installUrl()} className="w-fit text-sm underline">
						Add another GitHub account
					</a>
				</section>
			)}
		</div>
	);
}
