import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Packages run in parallel and share this cache, which made runs fail at random.
		fsModuleCache: false,
		include: ["src/**/*.test.ts"],
	},
});
