// The only way out of a restricted Docker sandbox: forwards to allowed domains, ports 80 and 443.
import dns from "node:dns/promises";
import http from "node:http";
import net from "node:net";

export const PORT = 3128;

const blocked = new net.BlockList();
for (const [address, bits] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.168.0.0", 16],
	["224.0.0.0", 3],
]) {
	blocked.addSubnet(address, bits, "ipv4");
}

/** "*.example.com" covers example.com and everything under it. */
export function domainAllowed(host, allowed) {
	const name = host.toLowerCase().replace(/\.$/, "");
	return allowed.some((entry) => {
		if (!entry.startsWith("*.")) return name === entry;
		const base = entry.slice(2);
		return name === base || name.endsWith(`.${base}`);
	});
}

// An allowed name must not lead into the server's own network.
export async function publicAddress(host, lookup = dns.lookup) {
	const { address } = await lookup(host, { family: 4 });
	if (blocked.check(address, "ipv4")) throw new Error("not a public address");
	return address;
}

export function createProxy(allowed, resolve = publicAddress) {
	const permitted = (host, port) => (port === 80 || port === 443) && domainAllowed(host, allowed);
	const refusal = (host) => `Blocked by the sandbox network rules: ${host}\n`;

	const server = http.createServer(async (request, response) => {
		let url;
		try {
			url = new URL(request.url);
		} catch {
			response.writeHead(400).end();
			return;
		}
		const port = Number(url.port || 80);
		if (url.protocol !== "http:" || !permitted(url.hostname, port)) {
			response.writeHead(403).end(refusal(url.hostname));
			return;
		}
		try {
			const upstream = http.request(
				{
					host: await resolve(url.hostname),
					port,
					method: request.method,
					path: `${url.pathname}${url.search}`,
					// The Host header is ours, so it cannot name a different site.
					headers: { ...request.headers, host: url.host },
				},
				(reply) => {
					response.writeHead(reply.statusCode ?? 502, reply.headers);
					reply.pipe(response);
				},
			);
			upstream.on("error", () => response.destroy());
			request.pipe(upstream);
		} catch {
			response.writeHead(502).end();
		}
	});

	server.on("connect", async (request, client, head) => {
		client.on("error", () => {});
		const [, host, port] = /^([^:]+):(\d+)$/.exec(request.url ?? "") ?? [];
		if (!host || !permitted(host, Number(port))) {
			client.end(`HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n${refusal(host ?? "address")}`);
			return;
		}
		try {
			const upstream = net.connect(Number(port), await resolve(host), () => {
				client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
				upstream.write(head);
				upstream.pipe(client);
				client.pipe(upstream);
			});
			upstream.on("error", () => client.destroy());
			client.on("close", () => upstream.destroy());
		} catch {
			client.end("HTTP/1.1 502 Bad Gateway\r\nconnection: close\r\n\r\n");
		}
	});

	return server;
}

if (process.env.EGRESS_ALLOW !== undefined) {
	createProxy(process.env.EGRESS_ALLOW.split(",").filter(Boolean)).listen(PORT, "0.0.0.0");
}
