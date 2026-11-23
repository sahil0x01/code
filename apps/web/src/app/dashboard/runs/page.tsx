import { requireSession } from "@/server/session";

export const metadata = { title: "Runs" };

export default async function RunsPage() {
	await requireSession();
	return <h1 className="text-2xl font-semibold">Runs</h1>;
}
