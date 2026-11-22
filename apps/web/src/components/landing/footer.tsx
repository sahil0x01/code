import Link from "next/link";
import { site } from "@/lib/site";

const legal = [
	{ href: "/terms", label: "Terms" },
	{ href: "/privacy", label: "Privacy" },
	{ href: "/acceptable-use", label: "Acceptable use" },
];

export function Footer() {
	return (
		<footer className="border-t-2 border-ink">
			<div className="mx-auto flex max-w-310 flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5 text-sm text-muted md:px-10">
				<span className="inline-flex items-center gap-2 text-foreground">
					<span
						aria-hidden="true"
						className="pixel-flat dither size-3 bg-background"
					/>
					code by nullfuse
				</span>
				<span>&copy; {site.year} NullFuse</span>

				<div className="flex-1" />

				<nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
					<a href={site.repoUrl} className="hover:text-foreground">
						Source code
					</a>
					<a
						href={`${site.repoUrl}/security/policy`}
						className="hover:text-foreground"
					>
						Security
					</a>
					{legal.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="hover:text-foreground"
						>
							{link.label}
						</Link>
					))}
				</nav>
			</div>
		</footer>
	);
}
