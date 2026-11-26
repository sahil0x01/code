import "server-only";
import {
	decryptEnvValue as decrypt,
	encryptEnvValue as encrypt,
	parseEncryptionKey,
} from "@nullfuse/secrets";
import { env } from "@/env";

const key = parseEncryptionKey(env.ENV_ENCRYPTION_KEY);

export function encryptEnvValue(projectId: string, name: string, value: string) {
	return encrypt(key, projectId, name, value);
}

export function decryptEnvValue(projectId: string, name: string, stored: string) {
	return decrypt(key, projectId, name, stored);
}
