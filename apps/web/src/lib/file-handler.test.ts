import { describe, expect, it } from "vitest";
import { type FileDeps, handleFiles } from "./file-handler";
import { listFiles } from "./file-source";

const id = "3f2b8c1e-1111-4222-8333-123456789abc";
const project = { fullName: "me/repo", installationId: 1, defaultBranch: "main" };
const list = { files: ["a.ts"], skills: [], partial: false };

const deps = (overrides: Partial<FileDeps> = {}): FileDeps => ({
	getProject: async (userId) => (userId === "me" ? project : null),
	listFiles: async () => list,
	...overrides,
});

describe("handleFiles", () => {
	it("only lists a project of the signed-in user", async () => {
		expect((await handleFiles(deps(), { userId: undefined, projectId: id, branch: null })).status).toBe(401);
		expect((await handleFiles(deps(), { userId: "other", projectId: id, branch: null })).status).toBe(404);
		expect(await (await handleFiles(deps(), { userId: "me", projectId: id, branch: null })).json()).toEqual(list);
	});

	it("falls back to the default branch while a chat's branch does not exist", async () => {
		const asked: string[] = [];
		const response = await handleFiles(
			deps({
				listFiles: async (_, __, branch) => {
					asked.push(branch);
					if (branch !== "main") throw Object.assign(new Error("none"), { status: 404 });
					return list;
				},
			}),
			{ userId: "me", projectId: id, branch: "nullfuse/chat-1" },
		);
		expect(response.status).toBe(200);
		expect(asked).toEqual(["nullfuse/chat-1", "main"]);
	});
});

describe("listFiles", () => {
	it("marks folders, leaves out dependencies and finds skills", async () => {
		const tree = [
			{ path: "src", type: "tree" },
			{ path: "src/a.ts", type: "blob" },
			{ path: "node_modules/x.js", type: "blob" },
			{ path: ".agents/skills/release/SKILL.md", type: "blob" },
			{ path: "sub", type: "commit" },
		];
		const result = await listFiles({ git: { getTree: async () => ({ data: { tree } }) } }, "me/repo", "main");
		expect(result).toEqual({
			files: ["src/", "src/a.ts", ".agents/skills/release/SKILL.md"],
			skills: ["release"],
			partial: false,
		});
	});
});
