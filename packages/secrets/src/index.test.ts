import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	decryptEnvValue,
	decryptSecret,
	encryptEnvValue,
	encryptSecret,
	parseEncryptionKey,
} from "./index";

const key = randomBytes(32);

describe("encryptSecret", () => {
	it("round-trips text, including empty and unicode", () => {
		for (const text of ["", "plain", "héllo ✓ 日本", "line1\nline2", "x".repeat(100_000)]) {
			expect(decryptSecret(key, encryptSecret(key, text, "ctx"), "ctx")).toBe(text);
		}
	});

	it("gives a different result each time for the same text", () => {
		expect(encryptSecret(key, "same", "ctx")).not.toBe(encryptSecret(key, "same", "ctx"));
	});

	it("has the versioned shape v1.iv.tag.data and hides the text", () => {
		const stored = encryptSecret(key, "super-secret-value", "ctx");
		expect(stored.split(".")).toHaveLength(4);
		expect(stored.startsWith("v1.")).toBe(true);
		expect(stored).not.toContain("super-secret-value");
	});

	it("rejects the wrong key, the wrong context and tampering", () => {
		const stored = encryptSecret(key, "value", "ctx");
		expect(() => decryptSecret(randomBytes(32), stored, "ctx")).toThrow();
		expect(() => decryptSecret(key, stored, "other")).toThrow();

		const [version, iv, tag, data] = stored.split(".");
		const flipped = `${data?.slice(0, -2)}${data?.endsWith("AA") ? "BB" : "AA"}`;
		expect(() => decryptSecret(key, [version, iv, tag, flipped].join("."), "ctx")).toThrow();
		expect(() => decryptSecret(key, [version, iv, "AAAA", data].join("."), "ctx")).toThrow();
	});

	it("rejects a value in an unknown format", () => {
		expect(() => decryptSecret(key, "v2.a.b.c", "ctx")).toThrow("Unsupported secret format");
		expect(() => decryptSecret(key, "garbage", "ctx")).toThrow("Unsupported secret format");
	});
});

describe("environment variable values", () => {
	it("are tied to their project and name", () => {
		const stored = encryptEnvValue(key, "project-1", "API_KEY", "abc");
		expect(decryptEnvValue(key, "project-1", "API_KEY", stored)).toBe("abc");
		expect(() => decryptEnvValue(key, "project-2", "API_KEY", stored)).toThrow();
		expect(() => decryptEnvValue(key, "project-1", "OTHER", stored)).toThrow();
	});
});

describe("parseEncryptionKey", () => {
	it("accepts 32 bytes and refuses anything else", () => {
		expect(parseEncryptionKey(randomBytes(32).toString("base64"))).toHaveLength(32);
		expect(() => parseEncryptionKey(randomBytes(16).toString("base64"))).toThrow(/32 bytes/);
		expect(() => parseEncryptionKey("")).toThrow();
	});
});
