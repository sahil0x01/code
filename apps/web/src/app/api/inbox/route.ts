import { getInbox, getPreferences } from "@nullfuse/db";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET() {
	const session = await getSession();
	if (!session) return new Response("Sign in again.", { status: 401 });

	const [inbox, preferences] = await Promise.all([
		getInbox(db, session.user.id),
		getPreferences(db, session.user.id),
	]);
	return Response.json({ ...inbox, preferences }, { headers: { "Cache-Control": "no-store" } });
}
