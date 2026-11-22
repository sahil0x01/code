import Link from "next/link";

export function Header() {
	return (
		<header className="flex flex-wrap items-center gap-x-7 gap-y-3 border-b-2 border-ink px-6 py-4 md:px-10">
			<Link href="/" className="inline-flex items-center gap-2.5">
				<span
					aria-hidden="true"
					className="pixel-flat dither size-4.5 bg-background"
				/>
				<span className="text-[17px] font-bold tracking-tight">code</span>
				<span className="font-mono text-xs text-muted">by nullfuse</span>
			</Link>

			<div className="flex-1" />

			<nav className="hidden items-center gap-6 text-sm text-muted sm:flex">
				<a href="#how" className="hover:text-foreground">
					How it works
				</a>
				<a href="#pricing" className="hover:text-foreground">
					Pricing
				</a>
				<a href="#self-host" className="hover:text-foreground">
					Self-host
				</a>
			</nav>

			<a
				href="#waitlist"
				className="pixel pressable inline-flex h-7 items-center bg-accent px-3 text-xs font-medium text-accent-foreground"
			>
				Join the waitlist
			</a>
		</header>
	);
}
