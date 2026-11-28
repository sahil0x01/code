/**
 * A tool returns text, which is what gets saved and shown, and the model is also given the
 * picture. The bytes are held here, beside the call, so they never reach the database.
 */
export function imageShelf() {
	const kept = new Map<string, { data: string; mediaType: string }>();
	return {
		keep(callId: string, bytes: Uint8Array, mediaType: string, text: string) {
			kept.set(callId, { data: Buffer.from(bytes).toString("base64"), mediaType });
			return text;
		},
		show(callId: string, text: string) {
			const image = kept.get(callId);
			if (!image) return { type: "text" as const, value: text };
			return {
				type: "content" as const,
				value: [
					{ type: "text" as const, text },
					{ type: "file" as const, mediaType: image.mediaType, data: { type: "data" as const, data: image.data } },
				],
			};
		},
	};
}
