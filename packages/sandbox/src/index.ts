import type { Sandbox } from "./types";

export {
	DockerDriver,
	destroyAllDockerSandboxes,
	dockerAvailable,
	ensureRecordingImage,
	ensureSandboxImage,
	recordingHarness,
	recordingImage,
	sandboxImage,
} from "./docker";
export { Agent37Driver, Agent37Error, agent37Templates, destroyStaleAgent37 } from "./agent37";
export {
	type DaytonaBox,
	type DaytonaClient,
	DaytonaDriver,
	ensureDaytonaRecordingSnapshot,
	ensureDaytonaSnapshot,
} from "./daytona";
export * from "./network";
export * from "./types";

export async function readText(sandbox: Sandbox, path: string) {
	return new TextDecoder().decode(await sandbox.readFile(path));
}
