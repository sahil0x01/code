import { EmptyState } from "@/components/dashboard/empty-state";
import { requireSession } from "@/server/session";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
	await requireSession();

	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold">Projects</h1>
			<EmptyState
				title="Connect GitHub to add your first project"
				description="A project is a GitHub repository the agent can work on. Pick the repos you want; we only ask for the access we need."
				action={{
					label: "Connect GitHub",
					disabled: true,
					note: "Coming soon. This is the next thing we are building.",
				}}
			/>
		</div>
	);
}
