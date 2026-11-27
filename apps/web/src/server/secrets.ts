import "server-only";
import {
	decryptEnvValue as decrypt,
	decryptModelKey as decryptModel,
	encryptModelKey as encryptModel,
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

type ModelOwner = Parameters<typeof encryptModel>[1];

export function encryptModelKey(model: ModelOwner, apiKey: string) {
	return encryptModel(key, model, apiKey);
}

export function decryptModelKey(model: ModelOwner, stored: string) {
	return decryptModel(key, model, stored);
}
