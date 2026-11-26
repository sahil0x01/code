import type { Sandbox } from "./types";

export {
	DockerDriver,
	destroyAllDockerSandboxes,
	dockerAvailable,
	ensureRecordingImage,
	ensureSandboxImage,
	recordingImage,
	sandboxImage,
} from "./docker";
export {
	type DaytonaBox,
	type DaytonaClient,
	DaytonaDriver,
	ensureDaytonaRecordingSnapshot,
	ensureDaytonaSnapshot,
} from "./daytona";
export * from "./types";

export async function readText(sandbox: Sandbox, path: string) {
	return new TextDecoder().decode(await sandbox.readFile(path));
}
