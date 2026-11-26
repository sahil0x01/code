import { getRunLive } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { handleLive } from "@/lib/live-handler";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(
	request: NextRequest,
	context: RouteContext<"/api/chats/[id]/runs/[runId]/live">,
) {
	const session = await getSession();
	const { id, runId } = await context.params;

	return handleLive(
		{ getLive: (userId, chatId, run) => getRunLive(db, userId, chatId, run) },
		{ userId: session?.user.id, chatId: id, runId, signal: request.signal },
	);
}
