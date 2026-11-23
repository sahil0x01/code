import { requireSession } from "@/server/session";

export const metadata = { title: "Credits" };

export default async function CreditsPage() {
	await requireSession();
	return <h1 className="text-2xl font-semibold">Credits</h1>;
}
