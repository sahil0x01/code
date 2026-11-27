import { connection } from "next/server";
import { loadPublicStats } from "@/server/public-stats";

export async function GET() {
	// Read at request time: the build has no database to prerender from.
	await connection();
	return Response.json(await loadPublicStats(), {
		headers: {
			"Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
			"Access-Control-Allow-Origin": "*",
		},
	});
}
