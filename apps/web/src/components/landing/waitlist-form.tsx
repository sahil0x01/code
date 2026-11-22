"use client";

import { useActionState } from "react";
import { joinWaitlist, type WaitlistState } from "@/actions/waitlist";

const initialState: WaitlistState = { status: "idle" };

export function WaitlistForm() {
	const [state, formAction, pending] = useActionState(
		joinWaitlist,
		initialState,
	);

	if (state.status === "success") {
		return (
			<output className="pixel-flat block bg-green px-4 py-3 font-medium">
				You are on the list. We will email you when there is room.
			</output>
		);
	}

	return (
		<form action={formAction} className="flex flex-col gap-3">
			<label
				htmlFor="waitlist-email"
				className="font-mono text-xs uppercase text-subtle"
			>
				Email
			</label>
			<div className="flex flex-wrap gap-3">
				<input
					id="waitlist-email"
					name="email"
					type="email"
					required
					autoComplete="email"
					placeholder="you@example.com"
					className="pixel-inset h-10.5 min-w-0 flex-1 bg-surface px-3 text-sm focus:bg-background"
				/>
				<input
					type="text"
					name="website"
					tabIndex={-1}
					autoComplete="off"
					aria-hidden="true"
					className="sr-only"
				/>
				<button
					type="submit"
					disabled={pending}
					className="pixel pressable h-10.5 bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-60"
				>
					{pending ? "Joining..." : "Join the waitlist"}
				</button>
			</div>
			{state.status === "error" && (
				<p role="alert" className="text-sm text-red">
					{state.message}
				</p>
			)}
		</form>
	);
}
