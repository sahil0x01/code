import { describe, expect, it } from "vitest";
import { checkBaseUrl, guardedFetch, isPrivateAddress } from "./safe-url";

describe("isPrivateAddress", () => {
	it.each([
		"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
		"::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "2002:a00:1::", "not-an-address",
	])("blocks %s", (address) => expect(isPrivateAddress(address)).toBe(true));

	it.each(["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111"])("allows %s", (address) =>
		expect(isPrivateAddress(address)).toBe(false),
	);
});

describe("checkBaseUrl", () => {
	it.each([
		"http://example.com/v1", "ftp://example.com", "https://user:pass@example.com", "https://example.com/v1?a=1",
		"https://127.0.0.1/v1", "https://[::1]/v1", "https://2130706433/v1", "https://localhost/v1", "nonsense",
	])("refuses %s", async (url) => {
		await expect(checkBaseUrl(url)).rejects.toThrow();
	});

	it("accepts a public address and drops the trailing slash", async () => {
		expect(await checkBaseUrl(" https://1.1.1.1/v1/ ")).toBe("https://1.1.1.1/v1");
	});

	it("allows a local server only when self-hosting says so", async () => {
		expect(await checkBaseUrl("http://localhost:8000/v1", { allowPrivate: true })).toBe("http://localhost:8000/v1");
	});
});

describe("guardedFetch", () => {
	it("refuses a private address when connecting, by name or number", async () => {
		await expect(guardedFetch()("https://127.0.0.1:8443/v1")).rejects.toThrow("private");
		await expect(guardedFetch()("https://localhost:8443/v1")).rejects.toMatchObject({
			cause: { name: "UnsafeUrlError" },
		});
	});
});
