import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Packages run in parallel and share this cache, which made runs fail at random.
		fsModuleCache: false,
		include: ["src/**/*.test.ts"],
		globalSetup: [path.join(import.meta.dirname, "../db/test/global-setup.ts")],
		testTimeout: 15_000,
	},
});
