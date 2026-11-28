import { detectMediaType, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS } from "@nullfuse/models/media";

export const ATTACHMENT_LIMITS = `Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB together.`;

/** Why these files cannot be sent together, or null. */
export function attachmentProblem(files: { size: number }[]) {
	if (files.length > MAX_ATTACHMENTS) return ATTACHMENT_LIMITS;
	if (files.reduce((sum, file) => sum + file.size, 0) > MAX_ATTACHMENT_BYTES) return ATTACHMENT_LIMITS;
	return null;
}

const cleanName = (name: string) =>
	name.replace(/[\u0000-\u001f\u007f/\\]+/g, " ").trim().slice(-120) || "file";

/** The files of a submitted form, or why they were refused. */
export async function readAttachments(formData: FormData) {
	const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
	const problem = attachmentProblem(files);
	if (problem) return { ok: false as const, problem };
	const attachments = await Promise.all(
		files.map(async (file) => {
			const data = Buffer.from(await file.arrayBuffer());
			return { name: cleanName(file.name), mediaType: detectMediaType(data), data };
		}),
	);
	return { ok: true as const, attachments };
}
