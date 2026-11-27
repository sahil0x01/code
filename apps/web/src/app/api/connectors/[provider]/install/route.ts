import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/env";
import { oauthProvider, STATE_COOKIE } from "@/server/connectors";
import { getSession } from "@/server/session";

export async function GET(_request: Request, ctx: RouteContext<"/api/connectors/[provider]/install">) {
	const { provider } = await ctx.params;
	const connector = oauthProvider(provider);
	if (!connector) return new Response("Not set up", { status: 404 });
	if (!(await getSession())) return NextResponse.redirect(new URL("/sign-in", env.NEXT_PUBLIC_APP_URL));

	// Checked on the way back, so nobody can be sent through a sign-in they did not start.
	const state = randomBytes(24).toString("base64url");
	const response = NextResponse.redirect(connector.authorizeUrl(state));
	response.cookies.set(STATE_COOKIE, state, {
		httpOnly: true,
		sameSite: "lax",
		secure: env.NEXT_PUBLIC_APP_URL.startsWith("https:"),
		path: `/api/connectors/${provider}`,
		maxAge: 10 * 60,
	});
	return response;
}
