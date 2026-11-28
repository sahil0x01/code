// Builds both sandbox images in your Agent37 workspace. Needs AGENT37_API_KEY.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { agent37Template } from "../image/agent37.mjs";

if (!process.env.AGENT37_API_KEY) {
	console.error("Set AGENT37_API_KEY first.");
	process.exit(1);
}

const imageDir = path.join(import.meta.dirname, "..", "image");
for (const kind of ["plain", "browser"]) {
	const { name, dockerfile } = agent37Template(imageDir, kind);
	// An empty folder, so nothing but the Dockerfile is uploaded.
	const folder = mkdtempSync(path.join(tmpdir(), "agent37-"));
	writeFileSync(path.join(folder, "Dockerfile"), dockerfile);
	console.log(`Building ${name}`);
	const built = spawnSync("npx", ["--yes", "agent37", "templates", "build", ".", "--name", name], {
		cwd: folder,
		stdio: "inherit",
	});
	rmSync(folder, { recursive: true, force: true });
	if (built.status !== 0) process.exit(built.status ?? 1);
}
