import { describe, expect, it } from "vitest";
import { allowedDomains } from "./network";

describe("allowedDomains", () => {
	it("restricts Docker and Agent37 unless told otherwise, and Daytona only when told", () => {
		expect(allowedDomains({ SANDBOX_DRIVER: "agent37" })).toContain("github.com");
		expect(allowedDomains({ SANDBOX_DRIVER: "docker" })).toContain("github.com");
		expect(allowedDomains({ SANDBOX_DRIVER: "docker", SANDBOX_NETWORK: "open" })).toBeUndefined();
		expect(allowedDomains({ SANDBOX_DRIVER: "daytona" })).toBeUndefined();
		expect(allowedDomains({ SANDBOX_DRIVER: "daytona", SANDBOX_NETWORK: "restricted" })).toContain("github.com");
	});

	it("adds the storage address and the operator's domains", () => {
		const list = allowedDomains({
			SANDBOX_DRIVER: "docker",
			R2_ACCOUNT_ID: "ABC",
			SANDBOX_ALLOW_DOMAINS: " api.example.com, *.Test.dev ",
		});
		expect(list).toEqual(
			expect.arrayContaining(["abc.r2.cloudflarestorage.com", "api.example.com", "*.test.dev"]),
		);
	});

	it("refuses something that is not a domain", () => {
		for (const bad of ["https://a.com", "*", "*.com", "10.0.0.1", "a.com/x"]) {
			expect(() => allowedDomains({ SANDBOX_DRIVER: "docker", SANDBOX_ALLOW_DOMAINS: bad })).toThrow();
		}
	});
});
