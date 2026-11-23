import { DashboardNav } from "@/components/dashboard/nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireSession } from "@/server/session";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardLayout({
	children,
}: LayoutProps<"/dashboard">) {
	const { user } = await requireSession();

	return (
		<div className="flex min-h-dvh flex-col md:flex-row">
			<aside className="flex flex-col gap-4 border-b border-border bg-surface p-4 md:w-56 md:border-r md:border-b-0">
				<p className="font-mono text-sm font-semibold">NullFuse Code</p>
				<DashboardNav />
				<div className="mt-auto flex flex-col gap-2 text-sm">
					<p className="truncate text-muted">{user.email}</p>
					<div className="flex items-center gap-2">
						<SignOutButton />
						<ThemeToggle />
					</div>
				</div>
			</aside>
			<main className="flex-1 p-6">{children}</main>
		</div>
	);
}
