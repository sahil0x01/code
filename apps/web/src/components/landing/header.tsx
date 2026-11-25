import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export function Header() {
	return (
		<header className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b-2 border-ink px-6 py-4 md:px-10">
			<Logo />

			<div className="flex-1" />

			<nav className="hidden items-center gap-6 text-sm text-muted sm:flex">
				<Link href="/#how" className="hover:text-foreground">
					How it works
				</Link>
				<Link href="/#pricing" className="hover:text-foreground">
					Pricing
				</Link>
				<Link href="/#self-host" className="hover:text-foreground">
					Self-host
				</Link>
				<Link href="/#faq" className="hover:text-foreground">
					FAQ
				</Link>
			</nav>

			<ThemeToggle />
			<Link
				href="/#waitlist"
				className="pixel pressable inline-flex h-7 items-center bg-accent px-3 text-xs font-medium text-accent-foreground"
			>
				Join the waitlist
			</Link>
		</header>
	);
}
