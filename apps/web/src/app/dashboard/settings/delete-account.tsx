"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { buttonClass, field } from "@/components/ui/styles";
import { authClient } from "@/lib/auth-client";

export function DeleteAccount({ email }: { email: string }) {
	const router = useRouter();
	const confirmId = useId();
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
			<div className="flex flex-col gap-3">
				<p className="text-sm">
					For your safety, sign in again before deleting your account.
				</p>
				<button
					type="button"
					className={`${buttonClass("secondary")} w-fit`}
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
		<div className="flex flex-col gap-3">
			<label htmlFor={confirmId} className="text-sm">
				Type <span className="font-mono">{email}</span> to confirm
			</label>
			<input
				id={confirmId}
				value={confirm}
				onChange={(e) => setConfirm(e.target.value)}
				autoComplete="off"
				spellCheck={false}
				className={`${field} max-w-sm font-mono`}
			/>
			<button
				type="button"
				className={`${buttonClass("danger")} w-fit`}
				disabled={confirm !== email}
				onClick={onDelete}
			>
				Delete my account
			</button>
			{error && (
				<p role="alert" className="text-sm text-red">
					{error}
				</p>
			)}
		</div>
	);
}
