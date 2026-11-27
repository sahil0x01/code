import { APICallError, RetryError } from "ai";

const MAX_CHARS = 300;

function unwrap(error: unknown) {
	let current = RetryError.isInstance(error) ? error.lastError : error;
	// Network failures arrive wrapped; the reason is in the cause.
	for (let depth = 0; depth < 4; depth++) {
		if (APICallError.isInstance(current) && current.statusCode !== undefined) return current;
		if (!(current instanceof Error) || !(current.cause instanceof Error)) return current;
		current = current.cause;
	}
	return current;
}

/** Why a call to a user's provider failed, in words they can act on. Never contains the key. */
export function explainModelError(error: unknown, apiKey: string) {
	const cause = unwrap(error);
	const status = APICallError.isInstance(cause) ? cause.statusCode : undefined;
	const raw = cause instanceof Error ? cause.message : String(cause);
	const said = apiKey ? raw.split(apiKey).join("[hidden]") : raw;
	const detail = said.length > MAX_CHARS ? `${said.slice(0, MAX_CHARS)}...` : said;

	// Providers repeat parts of a rejected key, so their own words are left out here.
	// Google answers a bad key with 400.
	if (status === 401 || status === 403 || /api key not valid|invalid api key/i.test(raw)) {
		return "Your provider rejected the API key. Check the key and what it is allowed to use.";
	}
	if (status === 402 || /insufficient.{0,20}(balance|quota|credit)|credit balance/i.test(raw)) {
		return "Your provider account is out of credit.";
	}
	if (status === 429) return "Your provider's rate limit or quota was reached. Try again later.";
	if (status === 404) return `Your provider does not know this model or address. It said: ${detail}`;
	if (status !== undefined && status >= 500) return `Your provider had a problem (${status}). Try again later.`;
	return `The model could not be used: ${detail}`;
}
