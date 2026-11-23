import { SignInButton } from "./sign-in-button";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
	return (
		<main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
			<h1 className="text-2xl font-semibold">Sign in to NullFuse Code</h1>
			<SignInButton />
		</main>
	);
}
