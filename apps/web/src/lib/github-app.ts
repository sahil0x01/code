import "server-only";
import { App } from "octokit";
import { env } from "@/env";

const app = new App({
	appId: env.GITHUB_APP_ID,
	privateKey: Buffer.from(env.GITHUB_APP_PRIVATE_KEY_BASE64, "base64").toString(
		"utf8",
	),
});

export function installUrl() {
	return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
}

/** What the owner granted, which can be less than the app now asks for. */
export async function installationPermissions(installationId: number) {
	const { data } = await app.octokit.rest.apps.getInstallation({ installation_id: installationId });
	return data.permissions;
}

export function getInstallationOctokit(installationId: number) {
	return app.getInstallationOctokit(installationId);
}
