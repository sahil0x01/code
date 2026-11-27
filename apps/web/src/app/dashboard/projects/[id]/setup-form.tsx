"use client";

import { useActionState, useId } from "react";
import { saveSetup, type SetupState } from "@/actions/project-setup";
import { buttonClass, field } from "@/components/ui/styles";

type Props = {
	projectId: string;
	installCommand: string;
	testCommand: string;
	startCommand: string;
	appPort: string;
	/** The fields were filled from the repository and are not saved yet. */
	suggested?: boolean;
};

const initialState: SetupState = { status: "idle" };

export function SetupForm({
	projectId,
	installCommand,
	testCommand,
	startCommand,
	appPort,
	suggested,
}: Props) {
	const [state, formAction, pending] = useActionState(saveSetup, initialState);
	const installId = useId();
	const testId = useId();
	const startId = useId();
	const portId = useId();

	return (
		<form action={formAction} className="flex max-w-xl flex-col gap-3">
			<input type="hidden" name="projectId" value={projectId} />

			{suggested && state.status !== "success" && (
				<p className="pixel-flat bg-surface-2 p-3 text-sm">
					Suggested from the repository. Check them and save to use them.
				</p>
			)}

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

			<label htmlFor={startId} className="font-mono text-xs uppercase text-subtle">
				Start command
			</label>
			<input
				id={startId}
				name="startCommand"
				defaultValue={startCommand}
				maxLength={500}
				placeholder="pnpm dev"
				className={`${field} font-mono`}
			/>

			<label htmlFor={portId} className="font-mono text-xs uppercase text-subtle">
				App port
			</label>
			<input
				id={portId}
				name="appPort"
				defaultValue={appPort}
				inputMode="numeric"
				pattern="[0-9]*"
				maxLength={5}
				placeholder="3000"
				className={`${field} w-32 font-mono`}
			/>
			<p className="text-sm text-muted">
				With both set, the agent can check its changes in a real browser, and you can tick
				&quot;Record video&quot; on a message to get a video.
			</p>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={pending}
					className={buttonClass()}
				>
					{pending ? "Saving..." : "Save setup"}
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
