import Link from "next/link";

type Action =
	| { label: string; href: string }
	| { label: string; disabled: true; note: string };

type Props = {
	title: string;
	description: string;
	action?: Action;
};

export function EmptyState({ title, description, action }: Props) {
	return (
		<section className="pixel-inset flex max-w-xl flex-col items-start gap-3 bg-surface p-6">
			<h2 className="text-lg font-semibold">{title}</h2>
			<p className="text-muted">{description}</p>
			{action && "href" in action ? (
				<Link
					href={action.href}
					className="pixel pressable bg-accent px-4 py-2 text-sm text-accent-foreground"
				>
					{action.label}
				</Link>
			) : action ? (
				<div className="flex flex-col gap-1">
					<button
						type="button"
						disabled
						className="pixel bg-surface-2 px-4 py-2 text-sm text-subtle"
					>
						{action.label}
					</button>
					<span className="text-xs text-subtle">{action.note}</span>
				</div>
			) : null}
		</section>
	);
}
