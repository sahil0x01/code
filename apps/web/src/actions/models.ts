"use server";

import { addUserModel, deleteUserModel, getUserModelSecret, markUserModelTested } from "@nullfuse/db";
import { checkBaseUrl, checkModel, isProviderId, lookupModel, UnsafeUrlError } from "@nullfuse/models";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { env } from "@/env";
import { allowModelCheck } from "@/lib/rate";
import { db } from "@/server/db";
import { decryptModelKey, encryptModelKey } from "@/server/secrets";
import { requireSession } from "@/server/session";

export type ModelState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

const failed = (message: string): ModelState => ({ status: "error", message });
const TOO_FAST = "Too many tests. Wait a minute and try again.";

const input = z.object({
	provider: z.custom<Parameters<typeof lookupModel>[0]>(isProviderId),
	modelId: z.string().trim().min(1).max(200).regex(/^\S+$/),
	label: z.string().trim().max(60),
	apiKey: z.string().trim().min(8).max(500).regex(/^[\x21-\x7e]+$/),
	baseUrl: z.string().trim().max(500),
	maxRunTokens: z.union([z.literal(""), z.coerce.number().int().min(10_000).max(100_000_000)]),
});

export async function addModel(_previous: ModelState, formData: FormData): Promise<ModelState> {
	const { user } = await requireSession();
	const parsed = input.safeParse({
		provider: formData.get("provider"),
		modelId: formData.get("modelId"),
		label: formData.get("label") ?? "",
		apiKey: formData.get("apiKey"),
		baseUrl: formData.get("baseUrl") ?? "",
		maxRunTokens: formData.get("maxRunTokens") ?? "",
	});
	if (!parsed.success) {
		return failed("Check the model name, the key, and that any token limit is at least 10,000.");
	}
	const { provider, modelId, apiKey, maxRunTokens } = parsed.data;
	if (!allowModelCheck(user.id)) return failed(TOO_FAST);

	try {
		const rules = { allowPrivate: env.ALLOW_PRIVATE_MODEL_URLS };
		const baseUrl = provider === "openai-compatible" ? await checkBaseUrl(parsed.data.baseUrl, rules) : null;
		const checked = await checkModel({ provider, modelId, apiKey, baseUrl }, rules);
		if (!checked.ok) return failed(checked.message);

		const found = await lookupModel(provider, modelId);
		const id = crypto.randomUUID();
		const owner = { id, userId: user.id, provider, baseUrl };
		const added = await addUserModel(db, {
			...owner,
			...found,
			modelId,
			label: parsed.data.label || modelId.slice(0, 60),
			keyEncrypted: encryptModelKey(owner, apiKey),
			keyLast4: apiKey.slice(-4),
			maxRunTokens: maxRunTokens === "" ? null : maxRunTokens,
		});
		if (!added.ok) {
			return failed(
				added.reason === "name_taken"
					? "You already have a model with that name. Give this one another name."
					: "You have reached the limit of saved models. Remove one first.",
			);
		}
	} catch (error) {
		if (error instanceof UnsafeUrlError) return failed(error.message);
		// The error is not logged: it can hold the request that carried the key.
		console.error("add model failed", error instanceof Error ? error.name : "unknown");
		return failed("Something went wrong. Try again.");
	}

	revalidatePath("/dashboard", "layout");
	return { status: "success" };
}

const idInput = z.object({ id: z.uuid() });

export async function testModel(_previous: ModelState, formData: FormData): Promise<ModelState> {
	const { user } = await requireSession();
	const parsed = idInput.safeParse({ id: formData.get("id") });
	if (!parsed.success) return failed("That model was not found.");
	if (!allowModelCheck(user.id)) return failed(TOO_FAST);

	try {
		const row = await getUserModelSecret(db, user.id, parsed.data.id);
		if (!row) return failed("That model was not found.");
		const rules = { allowPrivate: env.ALLOW_PRIVATE_MODEL_URLS };
		if (row.baseUrl) await checkBaseUrl(row.baseUrl, rules);
		const checked = await checkModel({ ...row, apiKey: decryptModelKey(row, row.keyEncrypted) }, rules);
		if (!checked.ok) return failed(checked.message);
		await markUserModelTested(db, user.id, row.id);
	} catch (error) {
		if (error instanceof UnsafeUrlError) return failed(error.message);
		console.error("test model failed", error instanceof Error ? error.name : "unknown");
		return failed("Something went wrong. Try again.");
	}

	revalidatePath("/dashboard", "layout");
	return { status: "success" };
}

export async function removeModel(formData: FormData) {
	const { user } = await requireSession();
	const parsed = idInput.safeParse({ id: formData.get("id") });
	if (!parsed.success) return;
	await deleteUserModel(db, user.id, parsed.data.id);
	revalidatePath("/dashboard", "layout");
}
