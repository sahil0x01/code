import Link from "next/link";
import { Suspense } from "react";
import { InboxProvider } from "@/components/dashboard/inbox";
import {
	DashboardNav,
	DashboardNavFallback,
} from "@/components/dashboard/nav";
import { PageSkeleton } from "@/components/dashboard/page-skeleton";
import {
	SidebarChats,
	SidebarChatsSkeleton,
} from "@/components/dashboard/sidebar-chats";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonClass } from "@/components/ui/styles";
import { requireSession } from "@/server/session";
import { SignOutButton } from "./sign-out-button";

// The frame (sidebar, logo, nav) renders immediately. Only the parts that need
// the session wait, each behind its own Suspense boundary, so navigating never
// shows a blank screen.
//
// Desktop sidebar: New chat, main nav, recent chats (scrolls), then account
// links and the signed-in user. Phone: a top bar with one row of links.
export default function DashboardLayout({
	children,
}: LayoutProps<"/dashboard">) {
	return (
		<InboxProvider>
			<div className="flex min-h-dvh flex-col md:flex-row">
				<aside className="flex flex-col gap-3 border-b border-border bg-surface p-4 md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:border-r md:border-b-0">
					<div className="flex items-center justify-between gap-3 md:px-1">
						<Logo href="/dashboard" />
						<div className="flex items-center gap-2 md:hidden">
							<SignOutButton />
							<ThemeToggle />
						</div>
					</div>

					<Link href="/dashboard/chats/new" className={`${buttonClass()} w-full`}>
						New chat
					</Link>

					<div className="md:hidden">
						<Suspense fallback={<DashboardNavFallback group="all" />}>
							<DashboardNav group="all" />
						</Suspense>
					</div>

					<div className="hidden md:block">
						<Suspense fallback={<DashboardNavFallback group="main" />}>
							<DashboardNav group="main" />
						</Suspense>
					</div>

					<div className="hidden min-h-0 flex-1 md:flex">
						<Suspense fallback={<SidebarChatsSkeleton />}>
							<SidebarChats />
						</Suspense>
					</div>

					<div className="hidden flex-col gap-3 md:flex">
						<Suspense fallback={<DashboardNavFallback group="account" />}>
							<DashboardNav group="account" />
						</Suspense>
						<div className="flex flex-col gap-3 border-t border-border pt-3">
							<Suspense fallback={<div className="h-8" />}>
								<UserCard />
							</Suspense>
							<div className="flex items-center gap-2">
								<SignOutButton />
								<ThemeToggle />
							</div>
						</div>
					</div>
				</aside>

				<main className="min-w-0 flex-1">
					<div className="mx-auto w-full max-w-4xl p-5 md:p-10">
						<Suspense fallback={<PageSkeleton />}>
							<SessionGate>{children}</SessionGate>
						</Suspense>
					</div>
				</main>
			</div>
		</InboxProvider>
	);
}

async function UserCard() {
	const { user } = await requireSession();
	const initial = (user.name || user.email).slice(0, 1).toUpperCase();

	return (
		<div className="flex min-w-0 items-center gap-2.5">
			<span
				aria-hidden="true"
				className="pixel-flat flex size-8 shrink-0 items-center justify-center bg-accent text-sm font-semibold text-accent-foreground"
			>
				{initial}
			</span>
			<span className="flex min-w-0 flex-col">
				<span className="truncate text-sm font-medium">{user.name}</span>
				<span className="truncate text-xs text-muted">{user.email}</span>
			</span>
		</div>
	);
}

// Redirects to sign-in before any dashboard page renders. Each page still
// calls requireSession itself; this is the shared safety net.
async function SessionGate({ children }: { children: React.ReactNode }) {
	await requireSession();
	return children;
}
