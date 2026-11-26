import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Finds the folder with the Dockerfiles. A bundler (Trigger.dev) moves this code into a
 * build folder, so when it is not next to the source, the repository above is searched.
 */
export function findImageDir(from: string) {
	const besideSource = path.join(from, "..", "image");
	if (existsSync(path.join(besideSource, "Dockerfile"))) return besideSource;

	for (let dir = from; dir !== path.dirname(dir); dir = path.dirname(dir)) {
		const found = path.join(dir, "packages", "sandbox", "image");
		if (existsSync(path.join(found, "Dockerfile"))) return found;
	}
	throw new Error(`Cannot find the sandbox image files from ${from}`);
}
