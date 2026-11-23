import { eq } from "drizzle-orm";
import type { Db } from "./index";
import { userPreference } from "./schema";

export type Preferences = {
	notifyRunFinished: boolean;
	notifyRunFailed: boolean;
};

export const defaultPreferences: Preferences = {
	notifyRunFinished: true,
	notifyRunFailed: true,
};

export async function getPreferences(
	db: Db,
	userId: string,
): Promise<Preferences> {
	const [row] = await db
		.select({
			notifyRunFinished: userPreference.notifyRunFinished,
			notifyRunFailed: userPreference.notifyRunFailed,
		})
		.from(userPreference)
		.where(eq(userPreference.userId, userId));

	return row ?? defaultPreferences;
}

export async function savePreferences(
	db: Db,
	userId: string,
	prefs: Preferences,
) {
	await db
		.insert(userPreference)
		.values({ userId, ...prefs })
		.onConflictDoUpdate({
			target: userPreference.userId,
			set: { ...prefs, updatedAt: new Date() },
		});
}
