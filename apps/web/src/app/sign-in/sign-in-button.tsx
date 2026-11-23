"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SignInButton() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function onClick() {
		setPending(true);
		setError(null);
		const { error } = await authClient.signIn.social({
			provider: "github",
			callbackURL: "/dashboard",
		});
		if (error) {
			setError("Could not start sign-in. Try again in a minute.");
			setPending(false);
		}
	}

	return (
		<div className="flex flex-col gap-3">
			<button
				type="button"
				onClick={onClick}
				disabled={pending}
				className="pixel pressable h-10.5 bg-accent px-5 text-sm font-medium text-accent-foreground disabled:opacity-60"
			>
				{pending ? "Redirecting to GitHub..." : "Continue with GitHub"}
			</button>
			{error && (
				<p role="alert" className="text-sm text-red">
					{error}
				</p>
			)}
		</div>
	);
}
