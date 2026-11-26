import type { Sandbox } from "./types";

export {
	DockerDriver,
	destroyAllDockerSandboxes,
	dockerAvailable,
	ensureSandboxImage,
	sandboxImage,
} from "./docker";
export {
	type DaytonaBox,
	type DaytonaClient,
	DaytonaDriver,
	ensureDaytonaSnapshot,
} from "./daytona";
export * from "./types";

export async function readText(sandbox: Sandbox, path: string) {
	return new TextDecoder().decode(await sandbox.readFile(path));
}
