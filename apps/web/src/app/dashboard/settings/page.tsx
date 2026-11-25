import { PageHeader } from "@/components/dashboard/page-header";
import { buttonClass } from "@/components/ui/styles";
import { requireSession } from "@/server/session";
import { DeleteAccount } from "./delete-account";
import { SettingsSection } from "./section";
import { getPreferences } from "@nullfuse/db";
import { db } from "@/server/db";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
	const { user } = await requireSession();
	const prefs = await getPreferences(db, user.id);

	return (
		<div className="flex max-w-xl flex-col gap-4">
			<PageHeader
				title="Settings"
				description="Your account, notifications and data."
			/>

			<SettingsForm
				name={user.name}
				email={user.email}
				notifyRunFinished={prefs.notifyRunFinished}
				notifyRunFailed={prefs.notifyRunFailed}
			/>

			<SettingsSection
				title="Your data"
				description="Download everything we store about you as a JSON file."
			>
				<a
					href="/api/account/export"
					download
					className={`${buttonClass("secondary")} w-fit`}
				>
					Download my data
				</a>
			</SettingsSection>

			<SettingsSection
				title="Delete account"
				description="This permanently deletes your account, projects and chats. It cannot be undone."
				danger
			>
				<DeleteAccount email={user.email} />
			</SettingsSection>
		</div>
	);
}
