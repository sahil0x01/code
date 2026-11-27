import type { ReactNode } from "react";

export function StatTile({ label, value, note }: { label: string; value: string; note?: ReactNode }) {
	return (
		<div className="pixel-inset flex min-w-0 flex-col gap-1 bg-surface p-4">
			<dt className="text-sm text-muted">{label}</dt>
			<dd className="truncate text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
			{note && <dd className="text-xs text-subtle">{note}</dd>}
		</div>
	);
}

export function StatGrid({ children }: { children: ReactNode }) {
	return <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">{children}</dl>;
}

export function StatSection({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="font-mono text-xs uppercase tracking-wide text-subtle">{title}</h2>
			{children}
		</section>
	);
}
