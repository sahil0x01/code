import { listInstallations, listProjects } from "@nullfuse/db";
import Link from "next/link";
import { EmptyState } from "@/components/dashboard/empty-state";
import { installUrl } from "@/lib/github-app";
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
		listProjects(db, session.user.id),
	]);

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold">Projects</h1>

			{projects.length > 0 ? (
				<ul className="flex max-w-xl flex-col gap-2">
					{projects.map((p) => (
						<li key={p.id} className="pixel-inset bg-surface p-3">
							<Link
								href={`/dashboard/projects/${p.id}`}
								className="font-semibold underline"
							>
								{p.fullName}
							</Link>
							<p className="text-sm text-muted">
								{p.isPrivate ? "Private" : "Public"} · {p.defaultBranch}
								{p.installationId === null ? " · disconnected" : ""}
							</p>
						</li>
					))}
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
				<section className="flex max-w-xl flex-col gap-3">
					<h2 className="font-semibold">GitHub accounts</h2>
					<ul className="flex flex-col gap-3">
						{installations.map((i) => (
							<li key={i.id} className="pixel-inset bg-surface p-4">
								<p className="font-semibold">{i.accountLogin}</p>
								<p className="text-sm text-muted">
									{i.accountType === "Organization"
										? "Organization"
										: "Personal"}
									{" · "}
									{i.repositorySelection === "all"
										? "all repositories"
										: "selected repositories"}
									{i.suspendedAt ? " · suspended" : ""}
								</p>
								<Link
									href={`/dashboard/projects/new?installation=${i.id}`}
									className="mt-2 inline-block text-sm underline"
								>
									Add repositories
								</Link>
							</li>
						))}
					</ul>
					<a
						href={installUrl()}
						className="pixel pressable w-fit bg-accent px-4 py-2 text-sm text-accent-foreground"
					>
						Add another account
					</a>
				</section>
			)}
		</div>
	);
}
