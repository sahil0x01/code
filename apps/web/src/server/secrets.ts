import "server-only";
import { env } from "@/env";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

const key = Buffer.from(env.ENV_ENCRYPTION_KEY, "base64");

const context = (projectId: string, name: string) => `${projectId}:${name}`;

export function encryptEnvValue(
	projectId: string,
	name: string,
	value: string,
) {
	return encryptSecret(key, value, context(projectId, name));
}

export function decryptEnvValue(
	projectId: string,
	name: string,
	stored: string,
) {
	return decryptSecret(key, stored, context(projectId, name));
}
