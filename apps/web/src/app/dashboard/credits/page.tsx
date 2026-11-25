import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { requireSession } from "@/server/session";

export const metadata = { title: "Credits" };

export default async function CreditsPage() {
	await requireSession();
	return (
		<div className="flex flex-col gap-6">
			<PageHeader
				title="Credits"
				description="What your runs cost."
			/>
			<EmptyState
				title="You have not used any credits"
				description="New accounts start with free credits. Each run spends credits based on the model and how long it works. Nothing is charged without your say-so."
			/>
		</div>
	);
}
