import "server-only";
import { type DetectedSetup, detectSetup } from "@/lib/detect";
import { getInstallationOctokit } from "@/lib/github-app";
import { splitRepo } from "@/lib/pr-source";

/** Null when the repository cannot be read or nothing could be suggested. */
export async function suggestSetup(installationId: number, fullName: string): Promise<DetectedSetup | null> {
	try {
		const octokit = await getInstallationOctokit(installationId);
		const repo = splitRepo(fullName);
		const { data: root } = await octokit.rest.repos.getContent({ ...repo, path: "" });
		if (!Array.isArray(root)) return null;
		const files = root.map((entry) => entry.name);

		let packageJson: string | null = null;
		if (files.includes("package.json")) {
			const { data } = await octokit.rest.repos.getContent({ ...repo, path: "package.json" });
			if (!Array.isArray(data) && data.type === "file") {
				packageJson = Buffer.from(data.content, "base64").toString("utf8");
			}
		}
		const found = detectSetup(files, packageJson);
		return Object.values(found).some(Boolean) ? found : null;
	} catch (error) {
		console.error("detect setup failed", error);
		return null;
	}
}
