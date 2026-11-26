import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";

type Model = Extract<LanguageModel, { specificationVersion: "v4" }>;

// The SDK already retries a failing call twice; this takes over when those are used up.
export function withFallback(primary: Model, fallbacks: Model[], onFallback?: (error: unknown) => void) {
	async function attempt<T>(
		first: () => PromiseLike<T>,
		again: (model: Model) => PromiseLike<T>,
		signal: AbortSignal | undefined,
	) {
		try {
			return await first();
		} catch (error) {
			if (signal?.aborted || fallbacks.length === 0) throw error;
			onFallback?.(error);
			let last = error;
			for (const model of fallbacks) {
				try {
					return await again(model);
				} catch (next) {
					if (signal?.aborted) throw next;
					last = next;
				}
			}
			throw last;
		}
	}

	const middleware: LanguageModelMiddleware = {
		specificationVersion: "v4",
		wrapGenerate: ({ doGenerate, params }) =>
			attempt(doGenerate, (model) => model.doGenerate(params), params.abortSignal),
		// Covers a stream that fails to start. One that breaks half way fails the run.
		wrapStream: ({ doStream, params }) =>
			attempt(doStream, (model) => model.doStream(params), params.abortSignal),
	};
	return wrapLanguageModel({ model: primary, middleware });
}
