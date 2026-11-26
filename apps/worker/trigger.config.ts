import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
	// A project ref is an identifier, not a secret.
	project: process.env.TRIGGER_PROJECT_REF ?? "proj_dpqazhuzswuopjhwohdz",
	dirs: ["./src/trigger"],
	maxDuration: 30 * 60,
});
