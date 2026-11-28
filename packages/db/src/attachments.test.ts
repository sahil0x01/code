import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test";
import { exportAccountData } from "./account";
import { getAttachment, listAttachments } from "./attachments";
import { createChat, deleteChat } from "./chats";
import { loadRunContext } from "./runs";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

const data = Buffer.from([0, 255, 1, 2, 0]);

async function sent() {
	const userId = await fixtures.user();
	const projectId = await fixtures.project(userId);
	const created = await createChat(db, {
		userId,
		projectId,
		baseBranch: "main",
		model: "deepseek-flash",
		content: "Look",
		attachments: [{ name: "a.bin", mediaType: "application/octet-stream", data }],
	});
	if (!created.ok) throw new Error(created.reason);
	return { userId, ...created };
}

describe("attachments", () => {
	it("reach the run with the same bytes", async () => {
		const { runId } = await sent();
		const context = await loadRunContext(db, runId);
		expect(context?.messages.at(-1)?.attachments).toEqual([
			{ name: "a.bin", mediaType: "application/octet-stream", data },
		]);
	});

	it("are only the owner's to see", async () => {
		const mine = await sent();
		const other = await fixtures.user();
		const [file] = await listAttachments(db, mine.userId, mine.chatId);
		if (!file) throw new Error("no file");

		expect(file).toMatchObject({ messageId: mine.messageId, size: data.length });
		await expect(listAttachments(db, other, mine.chatId)).resolves.toEqual([]);
		await expect(getAttachment(db, other, file.id)).resolves.toBeNull();
		await expect(getAttachment(db, mine.userId, file.id)).resolves.toMatchObject({ data });
	});

	it("are listed in the export and deleted with the chat", async () => {
		const { userId, chatId } = await sent();
		const exported = await exportAccountData(db, userId);
		const [file] = exported?.attachments ?? [];
		expect(file?.download).toBe(`/api/attachments/${file?.id}`);

		await deleteChat(db, userId, chatId).then((result) => expect(result.ok).toBe(true));
		await expect(getAttachment(db, userId, file?.id ?? "")).resolves.toBeNull();
	});
});
