"use client";

import { authClient } from "@/lib/auth-client";

export function SignInButton() {
	return (
		<button
			type="button"
			onClick={() =>
				authClient.signIn.social({ provider: "github", callbackURL: "/" })
			}
		>
			Continue with GitHub
		</button>
	);
}
