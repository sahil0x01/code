import type { AddressInfo } from "node:net";
import net from "node:net";
import { afterAll, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript, so a container can run it as it is
import { createProxy, domainAllowed, publicAddress } from "../image/egress/proxy.mjs";
import { DockerDriver, dockerAvailable, ensureSandboxImage } from "./docker";
import type { Sandbox } from "./types";

describe("domainAllowed", () => {
	const allowed = ["github.com", "*.npmjs.org"];

	it("matches names and their subdomains only where asked", () => {
		expect(domainAllowed("GitHub.com.", allowed)).toBe(true);
		expect(domainAllowed("registry.npmjs.org", allowed)).toBe(true);
		expect(domainAllowed("npmjs.org", allowed)).toBe(true);
		expect(domainAllowed("api.github.com", allowed)).toBe(false);
		expect(domainAllowed("evilnpmjs.org", allowed)).toBe(false);
		expect(domainAllowed("github.com.evil.test", allowed)).toBe(false);
		expect(domainAllowed("140.82.112.3", allowed)).toBe(false);
	});
});

describe("publicAddress", () => {
	const resolvesTo = (address: string) => async () => ({ address, family: 4 });

	it("refuses a name that leads to a private network", async () => {
		for (const address of ["127.0.0.1", "10.1.2.3", "172.17.0.1", "192.168.1.1", "169.254.169.254"]) {
			await expect(publicAddress("a.test", resolvesTo(address))).rejects.toThrow();
		}
		await expect(publicAddress("a.test", resolvesTo("93.184.216.34"))).resolves.toBe("93.184.216.34");
	});
});

describe("the proxy", () => {
	const server = createProxy(["allowed.test"], async () => "127.0.0.1");
	const listening = new Promise<number>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
	});

	afterAll(() => {
		server.close();
	});

	const connect = async (target: string) => {
		const port = await listening;
		return new Promise<string>((resolve) => {
			const socket = net.connect(port, "127.0.0.1", () => socket.write(`CONNECT ${target} HTTP/1.1\r\n\r\n`));
			socket.once("data", (data) => {
				resolve(data.toString().split("\r\n")[0] ?? "");
				socket.destroy();
			});
		});
	};

	it("refuses other domains and other ports", async () => {
		await expect(connect("other.test:443")).resolves.toContain("403");
		await expect(connect("allowed.test:22")).resolves.toContain("403");
	});
});

const hasDocker = await dockerAvailable();

describe.skipIf(!hasDocker)("a restricted Docker sandbox", () => {
	let sandbox: Sandbox;

	afterAll(async () => {
		await sandbox?.destroy();
	});

	const status = async (command: string) => (await sandbox.exec(command, { timeoutMs: 30_000 })).exitCode;

	it("reaches allowed domains and nothing else", { timeout: 15 * 60_000 }, async () => {
		const image = await ensureSandboxImage();
		sandbox = await new DockerDriver().create({ image, allowedDomains: ["example.com"] });
		const curl = "curl -fsS -m 20 -o /dev/null";

		expect(await status(`${curl} https://example.com`)).toBe(0);
		expect(await status(`node -e "fetch('https://example.com').then(r=>process.exit(r.ok?0:1))"`)).toBe(0);
		expect(await status(`${curl} https://example.org`)).not.toBe(0);
		// Ignoring the proxy finds no way out at all.
		expect(await status(`env -u https_proxy -u HTTPS_PROXY ${curl} https://example.com`)).not.toBe(0);
		expect(await status(`${curl} --noproxy '*' https://1.1.1.1`)).not.toBe(0);
		// The app under test is still reachable inside the sandbox.
		const local = `require('http').createServer((q,r)=>r.end()).listen(4173,async()=>{const r=await fetch('http://localhost:4173');process.exit(r.ok?0:1)})`;
		expect(await status(`node -e "${local}"`)).toBe(0);
	});
});
