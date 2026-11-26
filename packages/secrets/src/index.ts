import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const encode = (buffer: Buffer) => buffer.toString("base64url");
const decode = (text: string) => Buffer.from(text, "base64url");

export function parseEncryptionKey(base64: string) {
	const key = Buffer.from(base64, "base64");
	if (key.length !== 32) throw new Error("The encryption key must be 32 bytes, base64 encoded");
	return key;
}

export function encryptSecret(key: Buffer, plaintext: string, context: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(context));
	const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return [VERSION, encode(iv), encode(tag), encode(data)].join(".");
}

export function decryptSecret(key: Buffer, payload: string, context: string) {
	const [version, iv, tag, data] = payload.split(".");
	if (version !== VERSION || !iv || !tag || data === undefined) {
		throw new Error("Unsupported secret format");
	}
	const decipher = createDecipheriv("aes-256-gcm", key, decode(iv));
	decipher.setAAD(Buffer.from(context));
	decipher.setAuthTag(decode(tag));
	return Buffer.concat([decipher.update(decode(data)), decipher.final()]).toString("utf8");
}

// A stored value is only valid for the project and variable it was written for.
const envContext = (projectId: string, name: string) => `${projectId}:${name}`;

export function encryptEnvValue(key: Buffer, projectId: string, name: string, value: string) {
	return encryptSecret(key, value, envContext(projectId, name));
}

export function decryptEnvValue(key: Buffer, projectId: string, name: string, stored: string) {
	return decryptSecret(key, stored, envContext(projectId, name));
}
