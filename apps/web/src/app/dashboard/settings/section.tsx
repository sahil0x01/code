import type { ReactNode } from "react";

export function SettingsSection({
	title,
	description,
	danger = false,
	children,
}: {
	title: string;
	description?: string;
	danger?: boolean;
	children: ReactNode;
}) {
	return (
		<section className="pixel-inset flex flex-col gap-4 bg-surface p-5">
			<div className="flex flex-col gap-1">
				<h2 className={`font-semibold ${danger ? "text-red" : ""}`}>{title}</h2>
				{description && <p className="text-sm text-muted">{description}</p>}
			</div>
			{children}
		</section>
	);
}
