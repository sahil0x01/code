"use server";

import { z } from "zod";
import { waitlist } from "@nullfuse/db";
import { db } from "@/server/db";

export type WaitlistState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export async function joinWaitlist(
	_previous: WaitlistState,
	formData: FormData,
): Promise<WaitlistState> {
	if (formData.get("website")) {
		return { status: "success" };
	}

	const parsed = emailSchema.safeParse(formData.get("email"));
	if (!parsed.success) {
		return { status: "error", message: "Enter a valid email address." };
	}

	try {
		await db
			.insert(waitlist)
			.values({ email: parsed.data })
			.onConflictDoNothing();
	} catch (error) {
		console.error("waitlist insert failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}

	return { status: "success" };
}
