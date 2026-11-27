import { exportAccountData } from "@nullfuse/db";
import { db } from "@/server/db";
import { getSession } from "@/server/session";

export async function GET() {
	const session = await getSession();
	if (!session) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const data = await exportAccountData(db, session.user.id);
	if (!data) {
		return Response.json({ error: "Not found" }, { status: 404 });
	}

	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			"Content-Type": "application/json",
			"Content-Disposition": 'attachment; filename="prefill-code-data.json"',
			"Cache-Control": "no-store",
		},
	});
}
