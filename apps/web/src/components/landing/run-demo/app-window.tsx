import type { ReactNode } from "react";

const navItems = ["Projects", "Tasks", "Runs", "Credits", "Settings"];

export function show(on: boolean) {
	return on ? "visible" : "invisible";
}

type AppWindowProps = {
	url: string;
	activeNav: string;
	noticeShown: boolean;
	children: ReactNode;
};

export function AppWindow({
	url,
	activeNav,
	noticeShown,
	children,
}: AppWindowProps) {
	return (
		<div className="pixel overflow-hidden bg-background [--drop:8px]">
			<div className="flex items-center gap-3 border-b-2 border-ink bg-surface px-3 py-2">
				<span className="flex gap-1.5">
					<span className="pixel-flat size-2.5 bg-surface-2" />
					<span className="pixel-flat size-2.5 bg-surface-2" />
					<span className="pixel-flat size-2.5 bg-surface-2" />
				</span>
				<span className="pixel-inset min-w-0 flex-1 truncate bg-background px-3 py-1 font-mono text-xs text-muted">
					code.prefill.here{url}
				</span>
			</div>

			<div className="relative flex h-170 md:h-135">
				<nav className="hidden w-44 shrink-0 flex-col gap-2 border-r-2 border-ink bg-surface p-3 md:flex">
					<p className="mb-3 flex items-center gap-2 text-sm font-bold">
						<span className="pixel-flat dither size-3 bg-background" />
						code
					</p>
					{navItems.map((item) => (
						<span
							key={item}
							className={`px-2 py-1.5 text-sm ${
								item === activeNav
									? "pixel-flat bg-accent font-medium text-accent-foreground"
									: "text-muted"
							}`}
						>
							{item}
						</span>
					))}
				</nav>

				<div className="flex min-w-0 flex-1 flex-col overflow-hidden">
					{children}
				</div>

				<p
					className={`pixel-flat absolute right-4 top-4 flex items-center gap-3 bg-accent px-3 py-2 text-sm font-medium text-accent-foreground ${show(noticeShown)}`}
				>
					<span className="font-mono text-[10px] uppercase">notification</span>
					Run finished. Pull request #128 is ready.
				</p>
			</div>
		</div>
	);
}
