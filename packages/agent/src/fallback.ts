import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";

type Model = Extract<LanguageModel, { specificationVersion: "v4" }>;

// The SDK already retries a failing call twice; this takes over when those are used up.
export function withFallback(primary: Model, fallbacks: Model[], onFallback?: (error: unknown) => void) {
	const middleware: LanguageModelMiddleware = {
		specificationVersion: "v4",
		wrapGenerate: async ({ doGenerate, params }) => {
			try {
				return await doGenerate();
			} catch (error) {
				if (params.abortSignal?.aborted || fallbacks.length === 0) throw error;
				onFallback?.(error);
				let last = error;
				for (const model of fallbacks) {
					try {
						return await model.doGenerate(params);
					} catch (next) {
						if (params.abortSignal?.aborted) throw next;
						last = next;
					}
				}
				throw last;
			}
		},
	};
	return wrapLanguageModel({ model: primary, middleware });
}
