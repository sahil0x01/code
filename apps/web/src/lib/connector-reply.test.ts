import { escapeSlack } from "@nullfuse/connectors";
import { describe, expect, it } from "vitest";
import { taskReply } from "./connector-reply";

const app = "https://app.test";

describe("taskReply", () => {
	it("links the new chat", () => {
		const text = taskReply({ ok: true, chatId: "c1", projectName: "acme/<web>" }, app, escapeSlack);
		expect(text).toContain("https://app.test/dashboard/chats/c1");
		expect(text).toContain("acme/&lt;web&gt;");
	});

	it("says where to link an account", () => {
		expect(taskReply({ ok: false, reason: "not_linked" }, app)).toContain(
			"https://app.test/dashboard/settings#connections",
		);
	});
});
