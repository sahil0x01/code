import { lookup } from "node:dns";
import { lookup as resolve } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

const v4 = new BlockList();
for (const [address, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	v4.addSubnet(address, prefix, "ipv4");
}

// Kept apart from the IPv4 list: Node matches IPv4 addresses against mapped IPv6 rules.
const v6 = new BlockList();
for (const [address, prefix] of [
	["::", 96],
	["::ffff:0:0", 96],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["2001::", 23],
	["2001:db8::", 32],
	["2002::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
] as const) {
	v6.addSubnet(address, prefix, "ipv6");
}

export function isPrivateAddress(address: string) {
	const family = isIP(address);
	if (family === 4) return v4.check(address, "ipv4");
	if (family === 6) return v6.check(address, "ipv6");
	return true;
}

export class UnsafeUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafeUrlError";
	}
}

const PRIVATE = "That address points to a private or internal network, which is not allowed.";
const hostOf = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");

export type UrlRules = {
	/** For self-hosting: allows http and addresses on your own network. */
	allowPrivate?: boolean;
};

function parse(raw: string, rules: UrlRules) {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new UnsafeUrlError("Enter a full address, such as https://api.example.com/v1.");
	}
	if (url.protocol !== "https:" && !(rules.allowPrivate && url.protocol === "http:")) {
		throw new UnsafeUrlError("The address must start with https://.");
	}
	if (url.username || url.password || url.search || url.hash) {
		throw new UnsafeUrlError("The address cannot contain a password, query or fragment.");
	}
	const host = hostOf(url);
	if (!rules.allowPrivate && isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError(PRIVATE);
	return url;
}

/** Checks an address when it is saved. `guardedFetch` checks again on every connection. */
export async function checkBaseUrl(raw: string, rules: UrlRules = {}) {
	const url = parse(raw.trim(), rules);
	if (!rules.allowPrivate) {
		const found = await resolve(hostOf(url), { all: true }).catch(() => {
			throw new UnsafeUrlError("That address could not be found.");
		});
		if (found.some((entry) => isPrivateAddress(entry.address))) throw new UnsafeUrlError(PRIVATE);
	}
	return url.href.replace(/\/+$/, "");
}

// Runs as the connection is made, so a name cannot change its answer after being checked.
const publicLookup: LookupFunction = (hostname, options, callback) => {
	lookup(hostname, { ...options, all: true }, (error, found) => {
		if (error) return callback(error, "", 0);
		const first = found[0];
		if (!first || found.some((entry) => isPrivateAddress(entry.address))) {
			return callback(new UnsafeUrlError(PRIVATE), "", 0);
		}
		if (options.all) return callback(null, found);
		callback(null, first.address, first.family);
	});
};

let agent: Agent | undefined;

/** `fetch` for an address a user typed: public hosts only, and no redirects. */
export function guardedFetch(rules: UrlRules = {}): typeof fetch {
	return (async (input: string | URL | Request, init?: RequestInit) => {
		const url = parse(input instanceof Request ? input.url : String(input), rules);
		if (rules.allowPrivate) return fetch(url, { ...init, redirect: "error" });
		agent ??= new Agent({ connect: { lookup: publicLookup } });
		return undiciFetch(url, {
			...(init as Parameters<typeof undiciFetch>[1]),
			redirect: "error",
			dispatcher: agent,
		}) as unknown as Promise<Response>;
	}) as typeof fetch;
}
