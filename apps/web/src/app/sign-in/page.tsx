import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { getSession } from "@/server/session";
import { SignInButton } from "./sign-in-button";
import Link from "next/link";

export const metadata = { title: "Sign in" };

async function RedirectIfSignedIn() {
	const session = await getSession();
	if (session) redirect("/dashboard");
	return null;
}

export default function SignInPage() {
	return (
		<main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-4">
			<Suspense fallback={null}>
				<RedirectIfSignedIn />
			</Suspense>
			<Logo />

			<section className="pixel flex w-full max-w-sm flex-col gap-5 bg-surface p-6">
				<h1 className="text-xl font-semibold">Sign in to NullFuse Code</h1>
				<p className="text-sm text-muted">
					We use GitHub to sign you in. We read your name, email and avatar. We
					do not get access to your repositories until you connect them later.
				</p>
				<SignInButton />
				<p className="text-xs text-muted">
					Read our{" "}
					<Link href="/privacy" className="underline hover:text-foreground">
						Privacy Policy
					</Link>
					.
				</p>
			</section>
		</main>
	);
}
