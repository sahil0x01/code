export class ConnectorError extends Error {
	constructor(
		readonly provider: string,
		readonly code: string,
	) {
		super(`${provider} refused the request: ${code}`);
	}
}

export type Fetcher = typeof fetch;

/** One JSON request. The error never carries the address, which can hold a token. */
export async function request(provider: string, url: string, init: RequestInit, fetcher: Fetcher) {
	const response = await fetcher(url, { signal: AbortSignal.timeout(10_000), ...init }).catch(() => {
		throw new ConnectorError(provider, "unreachable");
	});
	const data: unknown = await response.json().catch(() => ({}));
	if (!response.ok) throw new ConnectorError(provider, `http_${response.status}`);
	return data;
}

export const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
	method: "POST",
	headers: { "content-type": "application/json; charset=utf-8", ...headers },
	body: JSON.stringify(body),
});

export function clip(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}
