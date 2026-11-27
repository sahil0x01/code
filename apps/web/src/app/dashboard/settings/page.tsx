import { PageHeader } from "@/components/dashboard/page-header";
import { buttonClass } from "@/components/ui/styles";
import { requireSession } from "@/server/session";
import { DeleteAccount } from "./delete-account";
import { SettingsSection } from "./section";
import { getPreferences, listConnections, listProjects, listUserModels } from "@nullfuse/db";
import { PROVIDERS, suggestModels } from "@nullfuse/models";
import { ModelsSection } from "./models-section";
import { db } from "@/server/db";
import { env } from "@/env";
import { discordConfig, slackConfig, telegramConfig } from "@/server/connectors";
import { SettingsForm } from "./settings-form";
import { ConnectionsSection } from "./connections-section";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: PageProps<"/dashboard/settings">) {
	const { user } = await requireSession();
	const { connect } = await searchParams;
	const [prefs, models, connections, projects, ...lists] = await Promise.all([
		getPreferences(db, user.id),
		listUserModels(db, user.id),
		listConnections(db, user.id),
		listProjects(db, user.id),
		...PROVIDERS.map(async ({ id }) => [id, await suggestModels(id)] as const),
	]);

	return (
		<div className="flex max-w-xl flex-col gap-4">
			<PageHeader
				title="Settings"
				description="Your account, notifications, models and data."
			/>

			<SettingsForm
				name={user.name}
				email={user.email}
				notifyRunFinished={prefs.notifyRunFinished}
				notifyRunFailed={prefs.notifyRunFailed}
			/>

			<ModelsSection
				models={models.map(({ price, ...model }) => ({ ...model, hasPrice: price !== null }))}
				suggestions={Object.fromEntries(lists)}
			/>

			<ConnectionsSection
				links={connections.flatMap(({ id, provider, workspaceName, projectId }) =>
					// GitHub links are made by commenting, and follow the repository.
					provider === "github" ? [] : [{ id, provider, name: workspaceName, projectId }],
				)}
				projects={projects
					.filter((project) => project.installationId !== null)
					.map(({ id, fullName }) => ({ id, fullName }))}
				available={{
					slack: slackConfig() !== null,
					discord: discordConfig() !== null,
					telegram: telegramConfig() !== null,
				}}
				githubHandle={env.GITHUB_APP_SLUG}
				result={connect === "connected" || connect === "failed" ? connect : null}
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
