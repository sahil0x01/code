"use client";

import { useActionState, useId } from "react";
import { saveSettings, type SettingsState } from "@/actions/settings";
import { buttonClass, field } from "@/components/ui/styles";
import { BrowserNotifications } from "./browser-notifications";
import { SettingsSection } from "./section";

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
		<form action={formAction} className="flex flex-col gap-4">
			<SettingsSection
				title="Profile"
				description={`Signed in as ${props.email}. Your email and avatar come from GitHub.`}
			>
				<div className="flex flex-col gap-2">
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
						className={`${field} max-w-sm`}
					/>
				</div>
			</SettingsSection>

			<SettingsSection title="Notifications">
				<fieldset className="flex flex-col gap-3">
					<legend className="sr-only">Notifications</legend>
					<label className="flex items-center gap-3 text-sm">
						<input
							type="checkbox"
							name="notifyRunFinished"
							defaultChecked={props.notifyRunFinished}
							className="size-4"
						/>
						Notify me when a run finishes
					</label>
					<label className="flex items-center gap-3 text-sm">
						<input
							type="checkbox"
							name="notifyRunFailed"
							defaultChecked={props.notifyRunFailed}
							className="size-4"
						/>
						Notify me when a run fails
					</label>
				</fieldset>
				<BrowserNotifications />
			</SettingsSection>

			<div className="flex items-center gap-3">
				<button type="submit" disabled={pending} className={buttonClass()}>
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
