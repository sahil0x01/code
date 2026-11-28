import { DEFAULT_ALLOWED_DOMAINS, parseDomains } from "@nullfuse/sandbox";
import type { WorkerEnv } from "./env";

type Settings = Pick<
	WorkerEnv,
	"SANDBOX_DRIVER" | "SANDBOX_NETWORK" | "SANDBOX_ALLOW_DOMAINS" | "R2_ACCOUNT_ID"
>;

/** The domains sandboxes may reach, or undefined for no limit. */
export function allowedDomains(env: Settings) {
	// Daytona refuses per-sandbox rules below its third tier, so there it is switched on by hand.
	const network = env.SANDBOX_NETWORK ?? (env.SANDBOX_DRIVER === "daytona" ? "open" : "restricted");
	if (network === "open") return undefined;
	return [
		...DEFAULT_ALLOWED_DOMAINS,
		// Recordings are uploaded from inside the sandbox.
		...(env.R2_ACCOUNT_ID ? [`${env.R2_ACCOUNT_ID.toLowerCase()}.r2.cloudflarestorage.com`] : []),
		...parseDomains(env.SANDBOX_ALLOW_DOMAINS ?? ""),
	];
}
