import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
	// A project ref is an identifier, not a secret.
	project: process.env.TRIGGER_PROJECT_REF ?? "proj_dpqazhuzswuopjhwohdz",
	dirs: ["./src/trigger"],
	maxDuration: 30 * 60,
	// The SDK loads some of its own files at run time, which bundling breaks.
	build: { external: ["@daytona/sdk"] },
});
