import { viewPreview } from "@nullfuse/db";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { previewView } from "@/lib/preview";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET(_request: NextRequest, context: RouteContext<"/api/chats/[id]/preview">) {
	const session = await getSession();
	if (!session) return Response.json({ error: "Sign in again." }, { status: 401 });
	const { id } = await context.params;
	if (!z.uuid().safeParse(id).success) return Response.json({ error: "Not found." }, { status: 404 });

	const row = await viewPreview(db, session.user.id, id);
	return Response.json(previewView(row), { headers: { "Cache-Control": "no-store" } });
}
