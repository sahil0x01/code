"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function DeleteAccount({ email }: { email: string }) {
	const router = useRouter();
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [needsReauth, setNeedsReauth] = useState(false);

	async function onDelete() {
		setError(null);
		const { error } = await authClient.deleteUser();
		if (!error) {
			router.push("/");
			router.refresh();
			return;
		}
		if (error.code === "SESSION_EXPIRED") {
			setNeedsReauth(true);
			return;
		}
		setError("Could not delete your account. Try again.");
	}

	if (needsReauth) {
		return (
			<div className="flex flex-col gap-2">
				<p>For your safety, sign in again before deleting your account.</p>
				<button
					type="button"
					onClick={() =>
						authClient.signIn.social({
							provider: "github",
							callbackURL: "/dashboard/settings",
						})
					}
				>
					Continue with GitHub
				</button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<label htmlFor="confirm">Type {email} to confirm</label>
			<input
				id="confirm"
				value={confirm}
				onChange={(e) => setConfirm(e.target.value)}
				autoComplete="off"
			/>
			<button
				type="button"
				className="pixel pressable h-10.5 w-fit bg-red px-5 text-sm font-medium text-white disabled:opacity-60"
				disabled={confirm !== email}
				onClick={onDelete}
			>
				Delete my account
			</button>
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
