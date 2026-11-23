import { requireSession } from "@/server/session";

export const metadata = { title: "Projects" };

export default async function ProjectsPage() {
	await requireSession();
	return <h1 className="text-2xl font-semibold">Projects</h1>;
}
