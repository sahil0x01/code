import type { Sandbox } from "@nullfuse/sandbox";
import { describe, expect, it } from "vitest";
import { estimateTokens, transcript } from "./compact";
import { readTool } from "./tools/read";

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]);
const sandbox = {
	workdir: "/workspace",
	exec: async () => ({ exitCode: 0, stdout: `file ${bytes.length}`, stderr: "", timedOut: false, truncated: false }),
	readFile: async () => bytes,
} as unknown as Sandbox;

const run = async (images: boolean) => {
	const tool = readTool(sandbox, { images });
	const options = { toolCallId: "call-1", messages: [], context: {} };
	const output = await tool.execute?.({ path: "shot.png" }, options as never);
	const shown = await tool.toModelOutput?.({ toolCallId: "call-1", input: { path: "shot.png" }, output } as never);
	return { output, shown };
};

describe("reading an image", () => {
	it("saves words and gives a model that sees the picture", async () => {
		const { output, shown } = await run(true);

		expect(output).toBe("Image shot.png (image/png, 6 bytes)");
		expect(shown).toMatchObject({
			type: "content",
			value: [
				{ type: "text" },
				{ type: "file", mediaType: "image/png", data: { type: "data", data: bytes.toString("base64") } },
			],
		});
	});

	it("refuses it as a binary file for a model that cannot", async () => {
		await expect(run(false)).rejects.toThrow("binary file");
	});
});

describe("files in the history", () => {
	const messages = [
		{
			role: "user" as const,
			content: [
				{ type: "text" as const, text: "look" },
				{ type: "file" as const, mediaType: "image/png", data: Buffer.alloc(2_000_000) },
			],
		},
	];

	it("count as a picture, not as their length in text", () => {
		expect(estimateTokens(messages)).toBeLessThan(2000);
		expect(transcript(messages, 100_000)).toBe("user: look");
	});
});
