import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
	title: string;
	description?: ReactNode;
	crumb?: { href: string; label: string };
	actions?: ReactNode;
};

export function PageHeader({ title, description, crumb, actions }: Props) {
	return (
		<header className="flex flex-col gap-3">
			{crumb && (
				<Link
					href={crumb.href}
					className="w-fit font-mono text-xs uppercase text-subtle hover:text-foreground"
				>
					← {crumb.label}
				</Link>
			)}
			<div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="break-words text-2xl font-semibold tracking-tight">
						{title}
					</h1>
					{description && (
						<div className="text-sm text-muted">{description}</div>
					)}
				</div>
				{actions && (
					<div className="flex shrink-0 flex-wrap items-center gap-3">
						{actions}
					</div>
				)}
			</div>
		</header>
	);
}
