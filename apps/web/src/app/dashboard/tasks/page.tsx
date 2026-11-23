import { EmptyState } from "@/components/dashboard/empty-state";
import { requireSession } from "@/server/session";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
	await requireSession();
	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold">Tasks</h1>
			<EmptyState
				title="No tasks yet"
				description="A task is a job you hand to the agent, like fixing a bug or adding a test. You need a project first."
				action={{ label: "Go to Projects", href: "/dashboard/projects" }}
			/>
		</div>
	);
}
