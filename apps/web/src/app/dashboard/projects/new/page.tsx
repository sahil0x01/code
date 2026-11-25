import { listInstallations, listProjects } from "@nullfuse/db";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/server/db";
import {
	listInstallationRepos,
	type InstallationRepo,
} from "@/server/github-repos";
import { requireSession } from "@/server/session";
import { RepoPicker } from "./repo-picker";

export const metadata = { title: "Add repositories" };

export default async function NewProjectPage({
	searchParams,
}: PageProps<"/dashboard/projects/new">) {
	const session = await requireSession();
	const { installation: requested } = await searchParams;

	const installations = await listInstallations(db, session.user.id);
	if (installations.length === 0) redirect("/dashboard/projects");

	const selected =
		installations.find((i) => String(i.id) === requested) ?? installations[0];

	let repos: InstallationRepo[] | null = null;
	try {
		repos = await listInstallationRepos(selected.id);
	} catch (error) {
		console.error("listing installation repos failed", error);
	}

	const projects = await listProjects(db, session.user.id);
	const importedIds = projects
		.filter((p) => p.installationId === selected.id)
		.map((p) => p.githubRepoId);

	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				crumb={{ href: "/dashboard/projects", label: "Projects" }}
				title="Add repositories"
				description="Pick the repositories the agent can work on."
			/>

			{installations.length > 1 ? (
				<nav className="flex flex-wrap gap-2">
					{installations.map((i) => (
						<Link
							key={i.id}
							href={`/dashboard/projects/new?installation=${i.id}`}
							className={`pixel pressable px-3 py-1 text-sm ${
								i.id === selected.id
									? "bg-accent text-accent-foreground"
									: "bg-surface-2"
							}`}
						>
							{i.accountLogin}
						</Link>
					))}
				</nav>
			) : null}

			{repos === null ? (
				<p className="max-w-xl text-muted">
					We could not load the repositories for {selected.accountLogin}. The
					app may have been removed on GitHub. Try again in a moment.
				</p>
			) : repos.length === 0 ? (
				<p className="max-w-xl text-muted">
					The app can not see any repositories on {selected.accountLogin} yet.
					Change which repositories it can access on GitHub, then come back.
				</p>
			) : (
				<RepoPicker
					key={selected.id}
					installationId={selected.id}
					repos={repos}
					importedIds={importedIds}
				/>
			)}
		</div>
	);
}
