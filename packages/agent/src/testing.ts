import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DockerDriver, Sandbox } from "@nullfuse/sandbox";

const run = promisify(execFile);

/** A sandbox running `git daemon` with a seeded repository, reachable from other sandboxes. */
export async function startGitRemote(driver: DockerDriver, image: string) {
	const sandbox = await driver.create({ image, memoryMb: 512 });
	const seeded = await sandbox.exec(
		[
			"set -e",
			"mkdir -p /tmp/srv",
			"git init -q --bare -b main /tmp/srv/remote.git",
			"git init -q -b main /tmp/seed",
			"cd /tmp/seed",
			"git config user.email seed@example.test",
			"git config user.name Seed",
			"mkdir src",
			"printf 'export const a = 1;\\n' > src/a.ts",
			"printf '# Project\\n' > README.md",
			"git add -A",
			'git commit -q -m "initial"',
			"git push -q /tmp/srv/remote.git main",
			"git daemon --reuseaddr --base-path=/tmp/srv --export-all --enable=receive-pack --listen=0.0.0.0 --pid-file=/tmp/daemon.pid --detach",
		].join("\n"),
	);
	if (seeded.exitCode !== 0) {
		await sandbox.destroy();
		throw new Error(`Could not start the git remote: ${seeded.stderr}`);
	}

	const { stdout } = await run("docker", [
		"inspect",
		"-f",
		"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
		sandbox.id,
	]);

	return {
		sandbox,
		url: `git://${stdout.trim()}/remote.git`,
		git: (args: string) => sandbox.exec(`git -C /tmp/srv/remote.git ${args}`),
	};
}

export type GitRemote = Awaited<ReturnType<typeof startGitRemote>>;

// Results for MockLanguageModelV4 from "ai/test".

export const usage = (input = 100, output = 20) => ({
	inputTokens: { total: input, noCache: input, cacheRead: undefined, cacheWrite: undefined },
	outputTokens: { total: output, text: output, reasoning: undefined },
});

let callCounter = 0;

export const toolCalls = (...calls: { name: string; input: unknown }[]) => ({
	content: calls.map((call) => ({
		type: "tool-call" as const,
		toolCallId: `call-${++callCounter}`,
		toolName: call.name,
		input: JSON.stringify(call.input),
	})),
	finishReason: { unified: "tool-calls" as const, raw: undefined },
	usage: usage(),
	warnings: [],
});

export const answer = (text: string, tokens = usage()) => ({
	content: [{ type: "text" as const, text }],
	finishReason: { unified: "stop" as const, raw: undefined },
	usage: tokens,
	warnings: [],
});

export type { Sandbox };
