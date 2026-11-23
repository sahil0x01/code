"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { savePreferences } from "@nullfuse/db";
import { auth } from "@/lib/auth";
import { db } from "@/server/db";
import { requireSession } from "@/server/session";

export type SettingsState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

const nameSchema = z.string().trim().min(1).max(60);

export async function saveSettings(
	_previous: SettingsState,
	formData: FormData,
): Promise<SettingsState> {
	const { user } = await requireSession();

	const name = nameSchema.safeParse(formData.get("name"));
	if (!name.success) {
		return { status: "error", message: "Enter a name of 1 to 60 characters." };
	}

	try {
		await auth.api.updateUser({
			headers: await headers(),
			body: { name: name.data },
		});
		await savePreferences(db, user.id, {
			notifyRunFinished: formData.get("notifyRunFinished") === "on",
			notifyRunFailed: formData.get("notifyRunFailed") === "on",
		});
	} catch (error) {
		console.error("save settings failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	revalidatePath("/dashboard", "layout");
	return { status: "success" };
}
