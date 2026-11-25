"use client";

import { useActionState, useId } from "react";
import { saveEnvVar, type SetupState } from "@/actions/project-setup";
import { buttonClass, field } from "@/components/ui/styles";

const initialState: SetupState = { status: "idle" };

export function EnvVarForm({ projectId }: { projectId: string }) {
	const [state, formAction, pending] = useActionState(saveEnvVar, initialState);
	const nameId = useId();
	const valueId = useId();

	return (
		<form action={formAction} className="flex max-w-xl flex-col gap-3">
			<input type="hidden" name="projectId" value={projectId} />

			<label
				htmlFor={nameId}
				className="font-mono text-xs uppercase text-subtle"
			>
				Name
			</label>
			<input
				id={nameId}
				name="name"
				required
				maxLength={100}
				placeholder="API_KEY"
				autoComplete="off"
				spellCheck={false}
				className={`${field} font-mono`}
			/>

			<label
				htmlFor={valueId}
				className="font-mono text-xs uppercase text-subtle"
			>
				Value
			</label>
			<input
				id={valueId}
				name="value"
				type="password"
				required
				maxLength={10000}
				autoComplete="off"
				className={`${field} font-mono`}
			/>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={pending}
					className={buttonClass()}
				>
					{pending ? "Saving..." : "Save variable"}
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
