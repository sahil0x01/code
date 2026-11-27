import { listProjects, listUserModels } from "@nullfuse/db";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";
import { Composer } from "./composer";

export const metadata = { title: "New chat" };

export default async function NewChatPage({
	searchParams,
}: PageProps<"/dashboard/chats/new">) {
	const session = await requireSession();
	const { project: requested } = await searchParams;

	const projects = (await listProjects(db, session.user.id)).filter(
		(project) => project.installationId !== null,
	);

	const header = (
		<PageHeader
			crumb={{ href: "/dashboard/chats", label: "Chats" }}
			title="New chat"
			description="Describe the work. You can keep talking to the agent in the same chat afterwards."
		/>
	);

	if (projects.length === 0) {
		return (
			<div className="flex flex-col gap-6">
				{header}
				<EmptyState
					title="No connected projects"
					description="A chat works inside one project. Connect a GitHub repository first."
					action={{ label: "Go to Projects", href: "/dashboard/projects" }}
				/>
			</div>
		);
	}

	const initial = projects.find((project) => project.id === requested);
	const ownModels = await listUserModels(db, session.user.id);

	return (
		<div className="flex flex-col gap-6">
			{header}
			<Composer
				ownModels={ownModels.map(({ id, label }) => ({ id, label }))}
				projects={projects.map((project) => ({
					id: project.id,
					fullName: project.fullName,
					defaultBranch: project.defaultBranch,
				}))}
				initialProjectId={(initial ?? projects[0])?.id ?? ""}
			/>
		</div>
	);
}
