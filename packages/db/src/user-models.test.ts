import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { connect, Fixtures } from "../test/index";
import {
	addMessage,
	addUserModel,
	createChat,
	deleteUserModel,
	exportAccountData,
	getUserModelSecret,
	listRuns,
	listUserModels,
	MAX_USER_MODELS,
	user,
	userModel,
} from "./index";

const db = connect();
const fixtures = new Fixtures(db);

afterAll(async () => {
	await fixtures.cleanup();
	await db.$client.end();
});

const model = (userId: string, label = "Mine") => ({
	id: crypto.randomUUID(),
	userId,
	provider: "anthropic" as const,
	modelId: "claude-test",
	label,
	keyEncrypted: "encrypted-secret",
	keyLast4: "1234",
});

describe("user models", () => {
	it("never lists or exports the stored key", async () => {
		const userId = await fixtures.user();
		await addUserModel(db, model(userId));
		const listed = await listUserModels(db, userId);
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain("encrypted-secret");
		expect(JSON.stringify(await exportAccountData(db, userId))).not.toContain("encrypted-secret");
	});

	it("keeps each user's models to themselves", async () => {
		const mine = await fixtures.user();
		const theirs = await fixtures.user();
		const row = model(mine);
		await addUserModel(db, row);
		expect(await getUserModelSecret(db, theirs, row.id)).toBeNull();
		expect(await deleteUserModel(db, theirs, row.id)).toBe(false);
		expect(await listUserModels(db, theirs)).toEqual([]);
	});

	it("refuses a repeated name and too many models", async () => {
		const userId = await fixtures.user();
		expect(await addUserModel(db, model(userId))).toEqual({ ok: true });
		expect(await addUserModel(db, model(userId))).toEqual({ ok: false, reason: "name_taken" });
		for (let n = 1; n < MAX_USER_MODELS; n++) await addUserModel(db, model(userId, `m${n}`));
		expect(await addUserModel(db, model(userId, "extra"))).toEqual({ ok: false, reason: "too_many" });
	});

	it("goes when the account goes", async () => {
		const userId = await fixtures.user();
		await addUserModel(db, model(userId));
		await db.delete(user).where(eq(user.id, userId));
		expect(await db.select().from(userModel).where(eq(userModel.userId, userId))).toEqual([]);
	});

	it("records the name on a run, and refuses a model that is gone or not theirs", async () => {
		const userId = await fixtures.user();
		const projectId = await fixtures.project(userId);
		const row = model(userId, "My Claude");
		await addUserModel(db, row);
		const input = { userId, projectId, baseBranch: "main", content: "Fix it" };

		const created = await createChat(db, { ...input, model: `own:${row.id}` });
		if (!created.ok) throw new Error(created.reason);
		expect((await listRuns(db, userId, created.chatId))[0]?.modelLabel).toBe("My Claude");

		const other = await fixtures.user();
		const otherProject = await fixtures.project(other);
		expect(await createChat(db, { ...input, userId: other, projectId: otherProject, model: `own:${row.id}` })).toEqual({
			ok: false,
			reason: "model_removed",
		});
		expect(await createChat(db, { ...input, model: "own:not-an-id" })).toEqual({ ok: false, reason: "model_removed" });

		await deleteUserModel(db, userId, row.id);
		expect(await addMessage(db, { userId, chatId: created.chatId, model: `own:${row.id}`, content: "More" })).toEqual({
			ok: false,
			reason: "model_removed",
		});
		expect((await listRuns(db, userId, created.chatId))[0]?.modelLabel).toBe("My Claude");
	});
});
