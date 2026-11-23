import { requireSession } from "@/server/session";
import { SignOutButton } from "./sign-out-button";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
	const { user } = await requireSession();

	return (
		<main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 px-4">
			<h1 className="text-2xl font-semibold">Hi, {user.name}</h1>
			<p>{user.email}</p>
			<SignOutButton />
		</main>
	);
}
