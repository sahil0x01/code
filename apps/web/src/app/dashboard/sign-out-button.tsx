"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
	const router = useRouter();

	return (
		<button
			type="button"
			className="pixel pressable h-7 bg-surface-2 px-3 text-xs"
			onClick={async () => {
				await authClient.signOut();
				router.push("/");
				router.refresh();
			}}
		>
			Sign out
		</button>
	);
}
