"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
	{ href: "/dashboard/projects", label: "Projects" },
	{ href: "/dashboard/tasks", label: "Tasks" },
	{ href: "/dashboard/runs", label: "Runs" },
	{ href: "/dashboard/credits", label: "Credits" },
	{ href: "/dashboard/settings", label: "Settings" },
] as const;

export function DashboardNav() {
	const pathname = usePathname();

	return (
		<nav aria-label="Dashboard" className="flex gap-2 md:flex-col">
			{items.map((item) => {
				const active = pathname.startsWith(item.href);
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? "page" : undefined}
						className={`px-3 py-2 text-sm ${
							active
								? "pixel-flat bg-accent text-accent-foreground"
								: "text-muted hover:text-foreground"
						}`}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}
