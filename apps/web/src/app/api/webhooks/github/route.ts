import {
	handleInstallation,
	handleInstallationRepositories,
	handlePullRequest,
	handleRepository,
	verifySignature,
} from "@/server/github-webhooks";

export async function POST(request: Request) {
	const body = await request.text();

	if (!verifySignature(body, request.headers.get("x-hub-signature-256"))) {
		return new Response("Invalid signature", { status: 401 });
	}

	try {
		const payload: unknown = JSON.parse(body);
		const event = request.headers.get("x-github-event");

		switch (event) {
			case "installation":
				await handleInstallation(payload);
				break;
			case "installation_repositories":
				await handleInstallationRepositories(payload);
				break;
			case "repository":
				await handleRepository(payload);
				break;
			case "pull_request":
				await handlePullRequest(payload);
				break;
			default:
				break;
		}
	} catch (error) {
		console.error("github webhook failed", error);
		return new Response("Bad payload", { status: 400 });
	}

	return new Response(null, { status: 204 });
}
