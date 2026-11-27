import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/env";
import { oauthProvider, STATE_COOKIE } from "@/server/connectors";
import { getSession } from "@/server/session";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/connectors/[provider]/callback">) {
	const { provider } = await ctx.params;
	const connector = oauthProvider(provider);
	if (!connector) return new Response("Not set up", { status: 404 });
	const session = await getSession();
	if (!session) return NextResponse.redirect(new URL("/sign-in", env.NEXT_PUBLIC_APP_URL));

	const back = (result: "connected" | "failed") => {
		const url = new URL("/dashboard/settings", env.NEXT_PUBLIC_APP_URL);
		url.searchParams.set("connect", result);
		url.hash = "connections";
		const response = NextResponse.redirect(url);
		response.cookies.delete({ name: STATE_COOKIE, path: `/api/connectors/${provider}` });
		return response;
	};

	const code = request.nextUrl.searchParams.get("code");
	const state = request.nextUrl.searchParams.get("state");
	const expected = request.cookies.get(STATE_COOKIE)?.value;
	// No code means the person pressed Cancel.
	if (!code || !state || !expected || state !== expected) return back("failed");

	try {
		await connector.link(session.user.id, code);
	} catch (error) {
		console.error(`${provider} connect failed`, error);
		return back("failed");
	}
	return back("connected");
}
