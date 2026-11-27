import { getRunRecording } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { handleVideo } from "@/lib/video-handler";
import { db } from "@/server/db";
import { recordingStore } from "@/server/recordings";
import { getSession } from "@/server/session";

export async function GET(
	_request: NextRequest,
	context: RouteContext<"/api/chats/[id]/runs/[runId]/screenshot/[number]">,
) {
	const session = await getSession();
	const { id, runId, number } = await context.params;
	const store = recordingStore();

	return handleVideo(
		{
			getRecording: (userId, chatId, run) => getRunRecording(db, userId, chatId, run),
			downloadUrl: store && ((key) => store.downloadUrl(key)),
		},
		{ userId: session?.user.id, chatId: id, runId, screenshot: number },
	);
}
