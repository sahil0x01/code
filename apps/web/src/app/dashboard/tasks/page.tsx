import { requireSession } from "@/server/session";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
	await requireSession();
	return <h1 className="text-2xl font-semibold">Tasks</h1>;
}
