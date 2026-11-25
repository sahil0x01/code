"use client";

import { useActionState, useId } from "react";
import { saveSetup, type SetupState } from "@/actions/project-setup";
import { buttonClass, field } from "@/components/ui/styles";

type Props = {
	projectId: string;
	installCommand: string;
	testCommand: string;
};

const initialState: SetupState = { status: "idle" };

export function SetupForm({ projectId, installCommand, testCommand }: Props) {
	const [state, formAction, pending] = useActionState(saveSetup, initialState);
	const installId = useId();
	const testId = useId();

	return (
		<form action={formAction} className="flex max-w-xl flex-col gap-3">
			<input type="hidden" name="projectId" value={projectId} />

			<label
				htmlFor={installId}
				className="font-mono text-xs uppercase text-subtle"
			>
				Install command
			</label>
			<input
				id={installId}
				name="installCommand"
				defaultValue={installCommand}
				maxLength={500}
				placeholder="pnpm install"
				className={`${field} font-mono`}
			/>

			<label
				htmlFor={testId}
				className="font-mono text-xs uppercase text-subtle"
			>
				Test command
			</label>
			<input
				id={testId}
				name="testCommand"
				defaultValue={testCommand}
				maxLength={500}
				placeholder="pnpm test"
				className={`${field} font-mono`}
			/>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={pending}
					className={buttonClass()}
				>
					{pending ? "Saving..." : "Save commands"}
				</button>
				{state.status === "success" && (
					<output className="text-sm text-green">Saved.</output>
				)}
				{state.status === "error" && (
					<p role="alert" className="text-sm text-red">
						{state.message}
					</p>
				)}
			</div>
		</form>
	);
}
