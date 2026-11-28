import type { Sandbox } from "@nullfuse/sandbox";
import { TEXT_ONLY } from "@nullfuse/models/media";
import { describe, expect, it } from "vitest";
import { attachFiles, safeName } from "./attachments";

function fakeSandbox() {
	const written = new Map<string, Uint8Array | string>();
	const sandbox = {
		writeFile: async (path: string, data: Uint8Array | string) => void written.set(path, data),
	} as unknown as Sandbox;
	return { sandbox, written };
}

const image = { name: "my shot.png", mediaType: "image/png", data: Buffer.from("png-bytes") };
const notes = { name: "notes.txt", mediaType: "text/plain", data: Buffer.from("remember this") };
const pdf = { name: "spec.pdf", mediaType: "application/pdf", data: Buffer.from("%PDF") };
const vision = { ...TEXT_ONLY, image: true, toolImage: true };

describe("attachFiles", () => {
	it("saves every file and shows the model only what it reads", async () => {
		const { sandbox, written } = fakeSandbox();

		const [message] = await attachFiles(
			sandbox,
			[{ role: "user", content: "Fix this", attachments: [image, notes, pdf] }],
			vision,
		);

		expect(written.size).toBe(3);
		expect([...written.keys()].every((path) => path.startsWith("/tmp/nullfuse-attachments/"))).toBe(true);
		const parts = message?.content as { type: string; text?: string; mediaType?: string }[];
		expect(parts.map((part) => part.mediaType ?? part.type)).toEqual(["text", "image/png"]);
		expect(parts[0]?.text).toContain("Fix this");
		expect(parts[0]?.text).toContain("remember this");
		expect(parts[0]?.text).toMatch(/spec\.pdf \(application\/pdf.*cannot view/);
	});

	it("gives a text-only model words and paths", async () => {
		const [message] = await attachFiles(
			fakeSandbox().sandbox,
			[{ role: "user", content: "Look", attachments: [image] }],
			TEXT_ONLY,
		);

		expect(typeof message?.content).toBe("string");
		expect(message?.content).toContain("my_shot.png");
	});

	it("drops the oldest pictures first when there are too many bytes", async () => {
		const big = { name: "a.png", mediaType: "image/png", data: Buffer.alloc(7 * 1024 * 1024) };

		const built = await attachFiles(
			fakeSandbox().sandbox,
			[
				{ role: "user", content: "old", attachments: [big] },
				{ role: "assistant", content: "ok" },
				{ role: "user", content: "new", attachments: [big] },
			],
			vision,
		);

		expect(built.map((message) => typeof message.content)).toEqual(["string", "string", "object"]);
	});

	it("leaves other messages as they were", async () => {
		const built = await attachFiles(fakeSandbox().sandbox, [{ role: "user", content: "hi" }], vision);
		expect(built).toEqual([{ role: "user", content: "hi" }]);
	});

	it("keeps a file name inside its folder", () => {
		expect(safeName("../../etc/passwd")).toBe("etc_passwd");
		expect(safeName("...")).toBe("file");
	});
});
