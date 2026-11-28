// Agent37 runs an image as it is, so the shared Dockerfiles get an unprivileged user and a
// process that stays up. Plain JavaScript, so the build script runs it without a compiler.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const ENDING = `
USER node
ENV HOME=/home/node
CMD ["tail", "-f", "/dev/null"]
`;

/** The name changes with the contents, so an edited image is never mistaken for the old one. */
export function agent37Template(imageDir, kind) {
	const folder = kind === "browser" ? path.join(imageDir, "recording") : imageDir;
	const dockerfile = readFileSync(path.join(folder, "Dockerfile"), "utf8") + ENDING;
	const hash = createHash("sha256").update(dockerfile).digest("hex").slice(0, 12);
	return { name: `nullfuse-${kind === "browser" ? "recording" : "sandbox"}-${hash}`, dockerfile };
}
