import { requireSession } from "@/server/session";
import { DeleteAccount } from "./delete-account";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
	const { user } = await requireSession();

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4">
			<h1 className="text-2xl font-semibold">Settings</h1>

			<section className="flex flex-col gap-2">
				<h2 className="font-semibold">Your data</h2>
				<p>Download everything we store about you as a JSON file.</p>
				<a href="/api/account/export" download>
					Download my data
				</a>
			</section>

			<section className="flex flex-col gap-2">
				<h2 className="font-semibold">Delete account</h2>
				<p>This permanently deletes your account. It cannot be undone.</p>
				<DeleteAccount email={user.email} />
			</section>
		</main>
	);
}
