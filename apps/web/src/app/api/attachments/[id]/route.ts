import { getAttachment } from "@nullfuse/db";
import { z } from "zod";
import { attachmentResponse } from "@/lib/attachment-response";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(_request: Request, context: RouteContext<"/api/attachments/[id]">) {
	const session = await getSession();
	if (!session) return new Response("Sign in first", { status: 401 });
	const { id } = await context.params;
	const file = z.uuid().safeParse(id).success ? await getAttachment(db, session.user.id, id) : null;
	return file ? attachmentResponse(file) : new Response("Not found", { status: 404 });
}
