"use server";

import {
	deleteEnvVar,
	getProjectForUser,
	listEnvVars,
	updateProjectSetup,
	upsertEnvVar,
} from "@nullfuse/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { encryptEnvValue } from "@/server/secrets";
import { requireSession } from "@/server/session";

export type SetupState =
	| { status: "idle" }
	| { status: "success" }
	| { status: "error"; message: string };

const command = z
	.string()
	.trim()
	.max(500)
	.transform((value) => (value === "" ? null : value));

const port = z
	.string()
	.trim()
	.regex(/^\d{0,5}$/)
	.transform((value) => (value === "" ? null : Number(value)))
	.pipe(z.number().int().min(1).max(65_535).nullable());

const setupSchema = z.object({
	projectId: z.uuid(),
	installCommand: command,
	testCommand: command,
	startCommand: command,
	appPort: port,
});

export async function saveSetup(
	_previous: SetupState,
	formData: FormData,
): Promise<SetupState> {
	const { user } = await requireSession();

	const input = setupSchema.safeParse({
		projectId: formData.get("projectId"),
		installCommand: formData.get("installCommand") ?? "",
		testCommand: formData.get("testCommand") ?? "",
		startCommand: formData.get("startCommand") ?? "",
		appPort: formData.get("appPort") ?? "",
	});
	if (!input.success) {
		return {
			status: "error",
			message: "Commands can be up to 500 characters, and the port is 1 to 65535.",
		};
	}

	if ((input.data.startCommand === null) !== (input.data.appPort === null)) {
		return { status: "error", message: "Set both the start command and the port, or neither." };
	}

	try {
		const project = await getProjectForUser(db, user.id, input.data.projectId);
		if (!project) return { status: "error", message: "Project not found." };

		await updateProjectSetup(db, project.id, {
			installCommand: input.data.installCommand,
			testCommand: input.data.testCommand,
			startCommand: input.data.startCommand,
			appPort: input.data.appPort,
		});
		revalidatePath(`/dashboard/projects/${project.id}`);
	} catch (error) {
		console.error("save project setup failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}
	return { status: "success" };
}

const MAX_ENV_VARS = 50;

const envVarSchema = z.object({
	projectId: z.uuid(),
	name: z
		.string()
		.trim()
		.min(1)
		.max(100)
		.regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
	value: z.string().min(1).max(10_000),
});

export async function saveEnvVar(
	_previous: SetupState,
	formData: FormData,
): Promise<SetupState> {
	const { user } = await requireSession();

	const input = envVarSchema.safeParse({
		projectId: formData.get("projectId"),
		name: formData.get("name"),
		value: formData.get("value"),
	});
	if (!input.success) {
		return {
			status: "error",
			message:
				"Use a name like API_KEY (letters, digits, underscore) and a non-empty value.",
		};
	}
	const { name, value } = input.data;

	try {
		const project = await getProjectForUser(db, user.id, input.data.projectId);
		if (!project) return { status: "error", message: "Project not found." };

		const existing = await listEnvVars(db, project.id);
		if (
			existing.length >= MAX_ENV_VARS &&
			!existing.some((variable) => variable.name === name)
		) {
			return {
				status: "error",
				message: `A project can have up to ${MAX_ENV_VARS} variables.`,
			};
		}

		await upsertEnvVar(
			db,
			project.id,
			name,
			encryptEnvValue(project.id, name, value),
		);
		revalidatePath(`/dashboard/projects/${project.id}`);
	} catch (error) {
		console.error("save env var failed", error);
		return { status: "error", message: "Something went wrong. Try again." };
	}
	return { status: "success" };
}

export async function removeEnvVar(formData: FormData) {
	const { user } = await requireSession();

	const input = z
		.object({ projectId: z.uuid(), name: z.string().min(1).max(100) })
		.safeParse({
			projectId: formData.get("projectId"),
			name: formData.get("name"),
		});
	if (!input.success) return;

	const project = await getProjectForUser(db, user.id, input.data.projectId);
	if (!project) return;

	await deleteEnvVar(db, project.id, input.data.name);
	revalidatePath(`/dashboard/projects/${project.id}`);
}
