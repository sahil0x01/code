import { EmptyState } from "@/components/dashboard/empty-state";
import { requireSession } from "@/server/session";

export const metadata = { title: "Runs" };

export default async function RunsPage() {
	await requireSession();
	return (
		<div className="flex flex-col gap-6">
			<h1 className="text-2xl font-semibold">Runs</h1>
			<EmptyState
				title="No runs yet"
				description="Every task you submit becomes a run. You will see its progress, the pull request it opens and a verification recording here."
			/>
		</div>
	);
}
