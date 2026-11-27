import { and, asc, count, eq } from "drizzle-orm";
import type { Db } from "./index";
import { userModel } from "./schema";

export const MAX_USER_MODELS = 20;

// Never includes the key, so a page cannot receive it by accident.
const shown = {
	id: userModel.id,
	provider: userModel.provider,
	modelId: userModel.modelId,
	label: userModel.label,
	baseUrl: userModel.baseUrl,
	keyLast4: userModel.keyLast4,
	contextTokens: userModel.contextTokens,
	price: userModel.price,
	maxRunTokens: userModel.maxRunTokens,
	createdAt: userModel.createdAt,
	testedAt: userModel.testedAt,
};

export function listUserModels(db: Db, userId: string) {
	return db.select(shown).from(userModel).where(eq(userModel.userId, userId)).orderBy(asc(userModel.createdAt));
}

/** The stored row with the encrypted key, only for its owner. */
export async function getUserModelSecret(db: Db, userId: string, id: string) {
	const [row] = await db
		.select()
		.from(userModel)
		.where(and(eq(userModel.id, id), eq(userModel.userId, userId)));
	return row ?? null;
}

export type AddUserModelResult = { ok: true } | { ok: false; reason: "too_many" | "name_taken" };

export function addUserModel(db: Db, input: typeof userModel.$inferInsert) {
	return db.transaction(async (tx): Promise<AddUserModelResult> => {
		const [row] = await tx.select({ n: count() }).from(userModel).where(eq(userModel.userId, input.userId));
		if ((row?.n ?? 0) >= MAX_USER_MODELS) return { ok: false, reason: "too_many" };
		const added = await tx
			.insert(userModel)
			.values(input)
			.onConflictDoNothing({ target: [userModel.userId, userModel.label] })
			.returning({ id: userModel.id });
		return added.length > 0 ? { ok: true } : { ok: false, reason: "name_taken" };
	});
}

export async function markUserModelTested(db: Db, userId: string, id: string) {
	await db
		.update(userModel)
		.set({ testedAt: new Date() })
		.where(and(eq(userModel.id, id), eq(userModel.userId, userId)));
}

export async function deleteUserModel(db: Db, userId: string, id: string) {
	const rows = await db
		.delete(userModel)
		.where(and(eq(userModel.id, id), eq(userModel.userId, userId)))
		.returning({ id: userModel.id });
	return rows.length > 0;
}
