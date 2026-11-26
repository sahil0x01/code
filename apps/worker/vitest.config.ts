import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		globalSetup: ["../../packages/db/test/global-setup.ts"],
		hookTimeout: 600_000,
	},
});
