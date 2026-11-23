"use client";

import { useActionState, useId } from "react";
import { saveSettings, type SettingsState } from "@/actions/settings";

type Props = {
	name: string;
	email: string;
	notifyRunFinished: boolean;
	notifyRunFailed: boolean;
};

const initialState: SettingsState = { status: "idle" };

export function SettingsForm(props: Props) {
	const [state, formAction, pending] = useActionState(
		saveSettings,
		initialState,
	);
	const nameId = useId();

	return (
		<form action={formAction} className="flex flex-col gap-8">
			<section className="flex flex-col gap-3">
				<h2 className="font-semibold">Profile</h2>
				<label
					htmlFor={nameId}
					className="font-mono text-xs uppercase text-subtle"
				>
					Name
				</label>
				<input
					id={nameId}
					name="name"
					defaultValue={props.name}
					required
					maxLength={60}
					autoComplete="name"
					className="pixel-inset h-10.5 bg-surface px-3 text-sm focus:bg-background"
				/>
				<p className="text-sm text-muted">
					Email: {props.email}. Your email and avatar come from GitHub.
				</p>
			</section>

			<fieldset className="flex flex-col gap-3">
				<legend className="mb-1 font-semibold">Notifications</legend>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="notifyRunFinished"
						defaultChecked={props.notifyRunFinished}
					/>
					Tell me in the app when a run finishes
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="notifyRunFailed"
						defaultChecked={props.notifyRunFailed}
					/>
					Tell me in the app when a run fails
				</label>
			</fieldset>

			<div className="flex items-center gap-3">
				<button
					type="submit"
					disabled={pending}
					className="pixel pressable h-10.5 bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-60"
				>
					{pending ? "Saving..." : "Save changes"}
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
