import { isImage } from "@nullfuse/models/media";

/** Only pictures are shown in the browser. Anything else is downloaded, so it cannot run as a page. */
export function attachmentResponse(file: { name: string; mediaType: string; data: Buffer }) {
	const inline = isImage(file.mediaType);
	return new Response(new Uint8Array(file.data), {
		headers: {
			"content-type": inline ? file.mediaType : "application/octet-stream",
			"content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, "_")}`,
			"content-security-policy": "default-src 'none'; sandbox",
			"x-content-type-options": "nosniff",
			"cache-control": "private, max-age=3600",
		},
	});
}
