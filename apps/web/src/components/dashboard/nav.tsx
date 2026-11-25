"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; exact?: boolean };

// Desktop: "main" sits under the New chat button, "account" at the bottom.
// Mobile: one row with everything ("all").
const main: Item[] = [
	{ href: "/dashboard/chats", label: "Chats", exact: true },
	{ href: "/dashboard/projects", label: "Projects" },
];
const account: Item[] = [
	{ href: "/dashboard/credits", label: "Credits" },
	{ href: "/dashboard/settings", label: "Settings" },
];

export type NavGroup = "main" | "account" | "all";

function itemsFor(group: NavGroup) {
	if (group === "main") return main;
	if (group === "account") return account;
	return [...main, ...account];
}

function NavList({ pathname, group }: { pathname: string; group: NavGroup }) {
	return (
		<nav
			aria-label={group === "account" ? "Account" : "Dashboard"}
			className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1 md:flex-col md:gap-0.5"
		>
			{itemsFor(group).map((item) => {
				// "Chats" is only the list page on desktop, where the recent chats
				// are listed (and highlighted) separately.
				const active =
					item.exact && group !== "all"
						? pathname === item.href
						: pathname.startsWith(item.href);
				return (
					<Link
						key={item.href}
						href={item.href}
						aria-current={active ? "page" : undefined}
						className={`shrink-0 border-l-2 px-3 py-2 text-sm ${
							active
								? "border-accent bg-surface-2 font-medium text-foreground"
								: "border-transparent text-muted hover:bg-surface-2 hover:text-foreground"
						}`}
					>
						{item.label}
					</Link>
				);
			})}
		</nav>
	);
}

// Reads the current path, so it must sit under a <Suspense> boundary.
export function DashboardNav({ group = "all" }: { group?: NavGroup }) {
	return <NavList pathname={usePathname()} group={group} />;
}

// What the layout shows until the path is known: the same links, none active.
export function DashboardNavFallback({ group = "all" }: { group?: NavGroup }) {
	return <NavList pathname="" group={group} />;
}
