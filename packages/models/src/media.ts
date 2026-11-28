// No imports besides types, so browser code can use this file.
import type { ProviderId } from "./providers";

export const MAX_ATTACHMENTS = 5;
// A request to the web app is limited to about 4.5 MB by common hosts.
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

/** What a model can be given directly. Every file also reaches the sandbox. */
export type ModelInputs = {
	image: boolean;
	pdf: boolean;
	audio: boolean;
	video: boolean;
	/** A tool's result can carry an image, so the agent can look at one it finds. */
	toolImage: boolean;
};

export const TEXT_ONLY: ModelInputs = { image: false, pdf: false, audio: false, video: false, toolImage: false };

const IMAGES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** The type from the file's first bytes. The name and the browser's claim are not trusted. */
export function detectMediaType(data: Uint8Array) {
	const starts = (bytes: number[], at = 0) => bytes.every((byte, index) => data[at + index] === byte);
	const text = (value: string, at = 0) => starts([...value].map((c) => c.charCodeAt(0)), at);
	if (starts([0x89, 0x50, 0x4e, 0x47])) return "image/png";
	if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
	if (text("GIF8")) return "image/gif";
	if (text("RIFF") && text("WEBP", 8)) return "image/webp";
	if (text("RIFF") && text("WAVE", 8)) return "audio/wav";
	if (text("ID3") || starts([0xff, 0xfb])) return "audio/mpeg";
	if (text("ftyp", 4)) return "video/mp4";
	if (starts([0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
	if (text("%PDF-")) return "application/pdf";
	if (!data.subarray(0, 8000).includes(0)) return "text/plain";
	return "application/octet-stream";
}

export const isImage = (mediaType: string) => IMAGES.includes(mediaType);

export function accepts(inputs: ModelInputs, mediaType: string) {
	if (isImage(mediaType)) return inputs.image;
	if (mediaType === "application/pdf") return inputs.pdf;
	if (mediaType.startsWith("audio/")) return inputs.audio;
	if (mediaType.startsWith("video/")) return inputs.video;
	return false;
}

/** DeepSeek Flash reads images; Pro does not. */
export function deepseekInputs(modelId: string): ModelInputs {
	const sees = modelId.includes("flash");
	return { ...TEXT_ONLY, image: sees, toolImage: sees };
}

/**
 * For a user's own model. `listed` is what the public model list says it reads, or null when
 * it is not there; `readsImages` is the user's word for a model at their own address.
 */
export function ownInputs(
	provider: ProviderId,
	modelId: string,
	listed: string[] | null,
	readsImages: boolean,
): ModelInputs {
	if (provider === "deepseek") return deepseekInputs(modelId);
	// Many servers cannot take an image back from a tool, so only the message carries one.
	if (provider === "openai-compatible") return { ...TEXT_ONLY, image: readsImages };
	const reads = listed ?? ["image", "pdf"];
	const image = reads.includes("image");
	return {
		image,
		pdf: reads.includes("pdf"),
		// Only Google's adapter sends these.
		audio: provider === "google" && reads.includes("audio"),
		video: provider === "google" && reads.includes("video"),
		toolImage: image,
	};
}
