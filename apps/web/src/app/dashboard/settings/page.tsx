import { requireSession } from "@/server/session";
import { DeleteAccount } from "./delete-account";
import { getPreferences } from "@nullfuse/db";
import { db } from "@/server/db";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
	const { user } = await requireSession();
	const prefs = await getPreferences(db, user.id);

	return (
		<main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4">
			<h1 className="text-2xl font-semibold">Settings</h1>

			<SettingsForm
				name={user.name}
				email={user.email}
				notifyRunFinished={prefs.notifyRunFinished}
				notifyRunFailed={prefs.notifyRunFailed}
			/>

			<section className="pixel-inset flex flex-col gap-2 bg-surface p-4">
				<h2 className="font-semibold">Your data</h2>
				<p>Download everything we store about you as a JSON file.</p>
				<a
					href="/api/account/export"
					download
					className="pixel pressable inline-flex h-10.5 w-fit items-center bg-surface-2 px-5 text-sm"
				>
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
