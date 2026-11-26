import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		globalSetup: ["../db/test/global-setup.ts"],
		testTimeout: 60_000,
		hookTimeout: 600_000,
	},
});
