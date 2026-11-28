import { accepts, detectMediaType, MAX_ATTACHMENT_BYTES, ownInputs } from "@nullfuse/models/media";
import { describe, expect, it } from "vitest";
import { attachmentResponse } from "./attachment-response";
import { readAttachments } from "./attachments";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1]);
const form = (...files: File[]) => {
	const data = new FormData();
	for (const file of files) data.append("files", file);
	return data;
};

describe("detectMediaType", () => {
	it("reads the contents, not the name", () => {
		expect(detectMediaType(png)).toBe("image/png");
		expect(detectMediaType(Buffer.from("%PDF-1.7"))).toBe("application/pdf");
		expect(detectMediaType(Buffer.from("<svg onload=alert(1)>"))).toBe("text/plain");
		expect(detectMediaType(new Uint8Array([1, 0, 2]))).toBe("application/octet-stream");
	});
});

describe("readAttachments", () => {
	it("keeps the files with a clean name and the real type", async () => {
		const result = await readAttachments(form(new File([png], "../shot\n.txt", { type: "text/html" })));
		expect(result).toMatchObject({ ok: true, attachments: [{ name: ".. shot .txt", mediaType: "image/png" }] });
	});

	it("ignores an empty file field and refuses too much", async () => {
		await expect(readAttachments(form(new File([], "")))).resolves.toMatchObject({ ok: true, attachments: [] });
		const many = Array.from({ length: 6 }, () => new File(["a"], "a"));
		await expect(readAttachments(form(...many))).resolves.toMatchObject({ ok: false });
		const big = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "big");
		await expect(readAttachments(form(big))).resolves.toMatchObject({ ok: false });
	});
});

describe("attachmentResponse", () => {
	const headers = (mediaType: string) =>
		attachmentResponse({ name: "a b.html", mediaType, data: Buffer.from("x") }).headers;

	it("shows pictures and downloads everything else", () => {
		expect(headers("image/png").get("content-type")).toBe("image/png");
		expect(headers("text/plain").get("content-type")).toBe("application/octet-stream");
		expect(headers("text/plain").get("content-disposition")).toMatch(/^attachment; /);
		expect(headers("text/plain").get("x-content-type-options")).toBe("nosniff");
	});
});

describe("ownInputs", () => {
	it("follows the model list, and the user's word for their own address", () => {
		expect(ownInputs("openai", "m", ["text"], false).image).toBe(false);
		expect(ownInputs("anthropic", "m", null, false)).toMatchObject({ image: true, pdf: true, audio: false });
		expect(ownInputs("google", "m", ["text", "image", "audio", "video", "pdf"], false).video).toBe(true);
		expect(ownInputs("openai-compatible", "m", null, false).image).toBe(false);
		expect(ownInputs("openai-compatible", "m", null, true)).toMatchObject({ image: true, toolImage: false });
		expect(ownInputs("deepseek", "deepseek-v4-pro", null, false).image).toBe(false);
		expect(accepts(ownInputs("deepseek", "deepseek-flash", null, false), "application/pdf")).toBe(false);
	});
});
