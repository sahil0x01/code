import type { RunRecording } from "@nullfuse/db";
import { z } from "zod";

export type VideoDeps = {
	getRecording(userId: string, chatId: string, runId: string): Promise<RunRecording | null>;
	/** Null when storage is not configured. */
	downloadUrl: ((key: string) => Promise<string>) | null;
};

const plain = (message: string, status: number) =>
	new Response(message, { status, headers: { "Cache-Control": "no-store" } });

/** Sends the owner to a short-lived link for the video, or for one of its screenshots. */
export async function handleVideo(
	deps: VideoDeps,
	input: { userId: string | undefined; chatId: string; runId: string; screenshot?: string },
) {
	if (!input.userId) {
		return new Response(null, { status: 302, headers: { Location: "/sign-in" } });
	}
	const ids = z.tuple([z.uuid(), z.uuid()]).safeParse([input.chatId, input.runId]);
	if (!ids.success) return plain("Recording not found.", 404);

	const recording = await deps.getRecording(input.userId, input.chatId, input.runId);
	if (recording?.status !== "recorded") return plain("Recording not found.", 404);
	const key =
		input.screenshot === undefined
			? recording.key
			: /^[0-9]$/.test(input.screenshot)
				? recording.screenshots?.[Number(input.screenshot)]?.key
				: undefined;
	if (!key) return plain("Screenshot not found.", 404);
	if (!deps.downloadUrl) return plain("Video storage isn't set up.", 503);

	return new Response(null, {
		status: 302,
		headers: {
			Location: await deps.downloadUrl(key),
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
}
