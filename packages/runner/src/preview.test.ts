import { randomBytes } from "node:crypto";
import { type GitRemote, startGitRemote } from "@nullfuse/agent/testing";
import { createChat, project, requestPreview, setWorkingBranchIfUnset, stopPreview, viewPreview } from "@nullfuse/db";
import { connect, Fixtures } from "@nullfuse/db/testing";
import {
	DockerDriver,
	dockerAvailable,
	ensureSandboxImage,
	type Sandbox,
	SandboxCapacityError,
	type SandboxDriver,
} from "@nullfuse/sandbox";
import { decryptEnvValue } from "@nullfuse/secrets";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunnerDeps } from "./execute";
import { PREVIEW_IDLE_MS, PREVIEW_MAX_MS, servePreview } from "./preview";

const db = connect();
const fixtures = new Fixtures(db);
const hasDocker = await dockerAvailable();
const key = randomBytes(32);
const SERVER = `node -e "require('http').createServer((q, r) => r.end('hi')).listen(3000)"`;

describe.skipIf(!hasDocker)("servePreview", () => {
	const docker = new DockerDriver();
	let image: string;
	let remote: GitRemote;
	let destroyed = 0;

	beforeAll(async () => {
		image = await ensureSandboxImage();
		remote = await startGitRemote(docker, image);
	});

	afterAll(async () => {
		await remote?.sandbox.destroy();
		await fixtures.cleanup();
		await db.$client.end();
	});

	const driver: SandboxDriver = {
		name: "with-preview",
		async create(options) {
			const box = await docker.create(options);
			return Object.create(box, {
				previewUrl: { value: async () => "https://3000-token.example.test" },
				destroy: {
					value: async () => {
						destroyed++;
						await box.destroy();
					},
				},
			}) as Sandbox;
		},
	};

	const deps = (overrides: Partial<RunnerDeps> = {}): RunnerDeps => ({
		db,
		driver,
		image,
		createModel: () => {
			throw new Error("a preview uses no model");
		},
		githubToken: async () => "unused-token",
		decryptEnvValue: (projectId, name, stored) => decryptEnvValue(key, projectId, name, stored),
		author: { name: "Test", email: "test@example.test" },
		repoUrl: () => remote.url,
		...overrides,
	});

	async function setup(startCommand = SERVER) {
		const userId = await fixtures.user();
		const projectId = await fixtures.project(userId);
		await db.update(project).set({ startCommand, appPort: 3000 }).where(eq(project.id, projectId));
		const created = await createChat(db, { userId, projectId, baseBranch: "main", model: "deepseek-v4-pro", content: "Go" });
		if (!created.ok) throw new Error(created.reason);
		await setWorkingBranchIfUnset(db, created.chatId, "nullfuse/preview-test");
		const requested = await requestPreview(db, userId, created.chatId);
		if (!requested.ok || !requested.start) throw new Error("expected a new preview");
		return { userId, chatId: created.chatId, generation: requested.generation };
	}

	it("serves the app, then stops once the user stops it", async () => {
		const { userId, chatId, generation } = await setup();
		const seen: unknown[] = [];
		const before = destroyed;

		await servePreview(deps(), chatId, generation, {
			pause: async () => {
				seen.push(await viewPreview(db, userId, chatId));
				if (seen.length === 2) await stopPreview(db, userId, chatId);
			},
		});

		expect(seen[0]).toMatchObject({ status: "ready", url: "https://3000-token.example.test" });
		expect(await viewPreview(db, userId, chatId)).toMatchObject({ status: "stopped", url: null });
		expect(destroyed).toBe(before + 1);
	}, 120_000);

	it.each([
		["nobody is looking", PREVIEW_IDLE_MS],
		["it reached its time limit", PREVIEW_MAX_MS],
	])("stops by itself when %s", async (_why, later) => {
		const { userId, chatId, generation } = await setup();
		let skew = 0;

		await servePreview(deps(), chatId, generation, {
			now: () => Date.now() + skew,
			pause: async () => void (skew = later),
		});

		expect(await viewPreview(db, userId, chatId)).toMatchObject({ status: "stopped" });
	}, 120_000);

	it("reports what the app printed when it dies at start", async () => {
		const { userId, chatId, generation } = await setup("echo no-such-script >&2; exit 1");

		await servePreview(deps(), chatId, generation, { pause: async () => {} });

		const row = await viewPreview(db, userId, chatId);
		expect(row?.status).toBe("failed");
		expect(row?.error).toContain("no-such-script");
	}, 120_000);

	it("says so when there is no room for a sandbox", async () => {
		const { userId, chatId, generation } = await setup();
		const full: SandboxDriver = {
			name: "full",
			create: async () => {
				throw new SandboxCapacityError("Total memory limit exceeded");
			},
		};

		await servePreview(deps({ driver: full }), chatId, generation, { pause: async () => {} });

		expect((await viewPreview(db, userId, chatId))?.error).toContain("no free sandbox");
	});
});
