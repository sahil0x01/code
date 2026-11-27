import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	escapeSlack,
	exchangeSlackCode,
	parseSlackCommand,
	parseSlackEvent,
	postSlackMessage,
	unescapeSlack,
	verifySlackSignature,
} from "./slack";

const secret = "signing-secret";
const now = 1_800_000_000_000;
const timestamp = String(now / 1000);
const sign = (body: string, at = timestamp, key = secret) =>
	`v0=${createHmac("sha256", key).update(`v0:${at}:${body}`).digest("hex")}`;
const check = (over: Partial<Parameters<typeof verifySlackSignature>[0]> = {}) =>
	verifySlackSignature({ body: "a=1", signature: sign("a=1"), timestamp, secret, now, ...over });

describe("verifySlackSignature", () => {
	it("accepts a signed, recent request", () => {
		expect(check()).toBe(true);
	});

	it("refuses a changed body, another secret or missing headers", () => {
		expect(check({ body: "a=2" })).toBe(false);
		expect(check({ signature: sign("a=1", timestamp, "other") })).toBe(false);
		expect(check({ signature: null })).toBe(false);
		expect(check({ timestamp: null })).toBe(false);
		expect(check({ signature: "v0=zz" })).toBe(false);
	});

	it("refuses an old request even when its signature is right", () => {
		const old = String(now / 1000 - 301);
		expect(check({ timestamp: old, signature: sign("a=1", old) })).toBe(false);
	});
});

describe("parseSlackCommand", () => {
	const fields = {
		team_id: "T1",
		user_id: "U1",
		trigger_id: "123.456",
		text: "fix the bug",
		response_url: "https://hooks.slack.com/commands/T1/1/abc",
	};
	const parse = (over: Record<string, string> = {}) =>
		parseSlackCommand(new URLSearchParams({ ...fields, ...over }).toString());

	it("reads a slash command", () => {
		expect(parse()).toEqual(fields);
	});

	it("refuses a reply address that is not Slack's", () => {
		expect(parse({ response_url: "https://example.com/x" })).toBeNull();
		expect(parse({ response_url: "http://hooks.slack.com/x" })).toBeNull();
		expect(parse({ response_url: "https://hooks.slack.com.example.com/x" })).toBeNull();
	});
});

describe("parseSlackEvent", () => {
	const mention = (event: object = {}) =>
		parseSlackEvent(
			JSON.stringify({
				type: "event_callback",
				team_id: "T1",
				event_id: "Ev1",
				authorizations: [{ user_id: "UBOT" }],
				event: { type: "app_mention", user: "U1", channel: "C1", text: "<@UBOT> fix it", ...event },
			}),
		);

	it("reads a tag, without the tag", () => {
		expect(mention()).toMatchObject({ kind: "mention", userId: "U1", workspaceId: "T1", text: "fix it" });
		expect(mention({ text: "please <@UBOT> see <https://a.test/x|the page> &amp; <https://b.test>" })).toMatchObject({
			text: "please  see the page (https://a.test/x) & https://b.test",
		});
	});

	it("answers the address check", () => {
		expect(parseSlackEvent(JSON.stringify({ type: "url_verification", challenge: "abc" }))).toEqual({
			kind: "verify",
			challenge: "abc",
		});
	});

	it("ignores bots, edits and other events", () => {
		expect(mention({ bot_id: "B1" })).toBeNull();
		expect(mention({ subtype: "message_changed" })).toBeNull();
		expect(mention({ type: "message" })).toBeNull();
		expect(parseSlackEvent("not json")).toBeNull();
	});
});

describe("text", () => {
	it("escapes mentions and links, and reads typed characters back", () => {
		expect(escapeSlack("<!channel> a & b")).toBe("&lt;!channel&gt; a &amp; b");
		expect(unescapeSlack("a &amp;lt; &lt;div&gt;")).toBe("a &lt; <div>");
	});
});

const answer = (body: unknown) => (async () => new Response(JSON.stringify(body))) as typeof fetch;


describe("Slack calls", () => {
	const input = { clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://app.test/cb" };

	it("reads the token, workspace and signed-in person", async () => {
		const body = { ok: true, access_token: "xoxb-1", team: { id: "T1", name: "Acme" }, authed_user: { id: "U1" } };
		await expect(exchangeSlackCode(input, answer(body))).resolves.toEqual({
			token: "xoxb-1",
			workspaceId: "T1",
			workspaceName: "Acme",
			externalUserId: "U1",
		});
	});

	it("fails when Slack says no with a 200", async () => {
		await expect(
			postSlackMessage({ token: "t", channel: "U1", text: "hi" }, answer({ ok: false, error: "token_revoked" })),
		).rejects.toThrow("token_revoked");
	});
});
